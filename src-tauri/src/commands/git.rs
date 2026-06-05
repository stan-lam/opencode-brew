use git2::{Repository, StatusOptions, Signature, BranchType, DiffOptions, FetchOptions, PushOptions, RemoteCallbacks, Cred};
use serde::{Deserialize, Serialize};
use tauri::command;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: Option<String>,
    pub staged: Vec<GitFileStatus>,
    pub unstaged: Vec<GitFileStatus>,
    pub untracked: Vec<GitFileStatus>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitCommitInfo {
    pub id: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub timestamp: String,
}

#[command]
pub async fn is_git_repo(path: String) -> bool {
    Repository::open(&path).is_ok()
}

#[command]
pub async fn git_init(path: String) -> Result<(), String> {
    Repository::init(&path)
        .map(|_| ())
        .map_err(|e| format!("Failed to initialize repository: {}", e))
}

#[command]
pub async fn git_status(path: String) -> Result<GitStatus, String> {
    let repo = Repository::open(&path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(String::from));
    
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .include_unmodified(false)
        .update_index(true)  // Force refresh of the index
        .no_refresh(false);  // Allow refresh
    
    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Failed to get status: {}", e))?;
    
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();
    
    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let status = entry.status();
        
        if status.is_index_new() || status.is_index_modified() || status.is_index_deleted() {
            let status_str = if status.is_index_new() {
                "added"
            } else if status.is_index_modified() {
                "modified"
            } else {
                "deleted"
            };
            staged.push(GitFileStatus {
                path: path.clone(),
                status: status_str.to_string(),
                staged: true,
            });
        }
        
        if status.is_wt_modified() || status.is_wt_deleted() {
            let status_str = if status.is_wt_modified() {
                "modified"
            } else {
                "deleted"
            };
            unstaged.push(GitFileStatus {
                path: path.clone(),
                status: status_str.to_string(),
                staged: false,
            });
        }
        
        if status.is_wt_new() {
            untracked.push(GitFileStatus {
                path,
                status: "untracked".to_string(),
                staged: false,
            });
        }
    }
    
    // Calculate ahead/behind counts relative to upstream
    let (ahead, behind) = calculate_ahead_behind(&repo);
    
    Ok(GitStatus {
        branch,
        staged,
        unstaged,
        untracked,
        ahead,
        behind,
    })
}

fn calculate_ahead_behind(repo: &Repository) -> (u32, u32) {
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return (0, 0),
    };
    
    let local_oid = match head.target() {
        Some(oid) => oid,
        None => return (0, 0),
    };
    
    // Try to find the upstream branch
    let branch_name = match head.shorthand() {
        Some(name) => name,
        None => return (0, 0),
    };
    
    // Look for upstream tracking branch (try common remotes)
    let upstream_ref = format!("refs/remotes/origin/{}", branch_name);
    let upstream_oid = match repo.refname_to_id(&upstream_ref) {
        Ok(oid) => oid,
        Err(_) => return (0, 0), // No upstream, can't determine ahead/behind
    };
    
    match repo.graph_ahead_behind(local_oid, upstream_oid) {
        Ok((ahead, behind)) => (ahead as u32, behind as u32),
        Err(_) => (0, 0),
    }
}

#[command]
pub async fn git_stage(repo_path: String, file_path: String) -> Result<(), String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let mut index = repo.index()
        .map_err(|e| format!("Failed to get index: {}", e))?;
    
    index.add_path(std::path::Path::new(&file_path))
        .map_err(|e| format!("Failed to stage file: {}", e))?;
    
    index.write()
        .map_err(|e| format!("Failed to write index: {}", e))?;
    
    Ok(())
}

#[command]
pub async fn git_unstage(repo_path: String, file_path: String) -> Result<(), String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let head = repo.head()
        .map_err(|e| format!("Failed to get HEAD: {}", e))?;
    
    let head_commit = head.peel_to_commit()
        .map_err(|e| format!("Failed to get HEAD commit: {}", e))?;
    
    repo.reset_default(Some(&head_commit.into_object()), &[std::path::Path::new(&file_path)])
        .map_err(|e| format!("Failed to unstage file: {}", e))?;
    
    Ok(())
}

#[command]
pub async fn git_commit(repo_path: String, message: String) -> Result<String, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let mut index = repo.index()
        .map_err(|e| format!("Failed to get index: {}", e))?;
    
    let oid = index.write_tree()
        .map_err(|e| format!("Failed to write tree: {}", e))?;
    
    let tree = repo.find_tree(oid)
        .map_err(|e| format!("Failed to find tree: {}", e))?;
    
    let signature = repo.signature()
        .or_else(|_| Signature::now("OpenIDE User", "user@openide.local"))
        .map_err(|e| format!("Failed to create signature: {}", e))?;
    
    let parent_commit = repo.head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok());
    
    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();
    
    let commit_oid = repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        &message,
        &tree,
        &parents,
    ).map_err(|e| format!("Failed to commit: {}", e))?;
    
    Ok(commit_oid.to_string())
}

#[command]
pub async fn git_branches(repo_path: String) -> Result<Vec<String>, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let branches = repo.branches(Some(BranchType::Local))
        .map_err(|e| format!("Failed to get branches: {}", e))?;
    
    let mut branch_names = Vec::new();
    for branch in branches.flatten() {
        if let Some(name) = branch.0.name().ok().flatten() {
            branch_names.push(name.to_string());
        }
    }
    
    Ok(branch_names)
}

#[command]
pub async fn git_checkout(repo_path: String, branch_name: String) -> Result<(), String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let obj = repo.revparse_single(&format!("refs/heads/{}", branch_name))
        .map_err(|e| format!("Failed to find branch: {}", e))?;
    
    repo.checkout_tree(&obj, None)
        .map_err(|e| format!("Failed to checkout: {}", e))?;
    
    repo.set_head(&format!("refs/heads/{}", branch_name))
        .map_err(|e| format!("Failed to set HEAD: {}", e))?;
    
    Ok(())
}

#[command]
pub async fn git_log(repo_path: String, limit: Option<usize>) -> Result<Vec<GitCommitInfo>, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let mut revwalk = repo.revwalk()
        .map_err(|e| format!("Failed to create revwalk: {}", e))?;
    
    revwalk.push_head()
        .map_err(|e| format!("Failed to push HEAD: {}", e))?;
    
    let limit = limit.unwrap_or(50);
    let mut commits = Vec::new();
    
    for (i, oid) in revwalk.flatten().enumerate() {
        if i >= limit {
            break;
        }
        
        if let Ok(commit) = repo.find_commit(oid) {
            let timestamp = chrono::DateTime::from_timestamp(commit.time().seconds(), 0)
                .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
                .unwrap_or_default();
            
            commits.push(GitCommitInfo {
                id: oid.to_string(),
                message: commit.message().unwrap_or("").to_string(),
                author: commit.author().name().unwrap_or("Unknown").to_string(),
                email: commit.author().email().unwrap_or("").to_string(),
                timestamp,
            });
        }
    }
    
    Ok(commits)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffLine {
    pub line_type: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileDiff {
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub status: String,
    pub hunks: Vec<DiffHunk>,
    pub additions: u32,
    pub deletions: u32,
}

#[command]
pub async fn git_diff_file(repo_path: String, file_path: String, staged: bool) -> Result<FileDiff, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;

    let mut diff_options = DiffOptions::new();
    diff_options.pathspec(&file_path);

    let diff = if staged {
        let head = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head.as_ref(), None, Some(&mut diff_options))
    } else {
        repo.diff_index_to_workdir(None, Some(&mut diff_options))
    }.map_err(|e| format!("Failed to get diff: {}", e))?;

    let mut file_diff = FileDiff {
        old_path: None,
        new_path: None,
        status: String::new(),
        hunks: Vec::new(),
        additions: 0,
        deletions: 0,
    };

    // Get file info from first delta
    if let Some(delta) = diff.deltas().next() {
        file_diff.old_path = delta.old_file().path().map(|p| p.to_string_lossy().to_string());
        file_diff.new_path = delta.new_file().path().map(|p| p.to_string_lossy().to_string());
        file_diff.status = match delta.status() {
            git2::Delta::Added => "added",
            git2::Delta::Deleted => "deleted",
            git2::Delta::Modified => "modified",
            git2::Delta::Renamed => "renamed",
            git2::Delta::Copied => "copied",
            _ => "unknown",
        }.to_string();
    }

    // Use patch API to get hunks and lines
    if let Ok(Some(patch)) = git2::Patch::from_diff(&diff, 0) {
        let (_, additions, deletions) = patch.line_stats().unwrap_or((0, 0, 0));
        file_diff.additions = additions as u32;
        file_diff.deletions = deletions as u32;

        for hunk_idx in 0..patch.num_hunks() {
            if let Ok((hunk, _)) = patch.hunk(hunk_idx) {
                let mut diff_hunk = DiffHunk {
                    header: String::from_utf8_lossy(hunk.header()).trim().to_string(),
                    old_start: hunk.old_start(),
                    old_lines: hunk.old_lines(),
                    new_start: hunk.new_start(),
                    new_lines: hunk.new_lines(),
                    lines: Vec::new(),
                };

                for line_idx in 0..patch.num_lines_in_hunk(hunk_idx).unwrap_or(0) {
                    if let Ok(line) = patch.line_in_hunk(hunk_idx, line_idx) {
                        let line_type = match line.origin() {
                            '+' => "addition",
                            '-' => "deletion",
                            ' ' => "context",
                            _ => "other",
                        };

                        diff_hunk.lines.push(DiffLine {
                            line_type: line_type.to_string(),
                            old_lineno: line.old_lineno(),
                            new_lineno: line.new_lineno(),
                            content: String::from_utf8_lossy(line.content()).to_string(),
                        });
                    }
                }

                file_diff.hunks.push(diff_hunk);
            }
        }
    }

    Ok(file_diff)
}

#[command]
pub async fn git_diff_all(repo_path: String, staged: bool) -> Result<Vec<FileDiff>, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;

    let diff = if staged {
        let head = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head.as_ref(), None, None)
    } else {
        repo.diff_index_to_workdir(None, None)
    }.map_err(|e| format!("Failed to get diff: {}", e))?;

    let mut diffs: Vec<FileDiff> = Vec::new();

    for (idx, delta) in diff.deltas().enumerate() {
        let mut file_diff = FileDiff {
            old_path: delta.old_file().path().map(|p| p.to_string_lossy().to_string()),
            new_path: delta.new_file().path().map(|p| p.to_string_lossy().to_string()),
            status: match delta.status() {
                git2::Delta::Added => "added",
                git2::Delta::Deleted => "deleted",
                git2::Delta::Modified => "modified",
                git2::Delta::Renamed => "renamed",
                git2::Delta::Copied => "copied",
                _ => "unknown",
            }.to_string(),
            hunks: Vec::new(),
            additions: 0,
            deletions: 0,
        };

        if let Ok(patch) = git2::Patch::from_diff(&diff, idx) {
            if let Some(patch) = patch {
                let (_, additions, deletions) = patch.line_stats().unwrap_or((0, 0, 0));
                file_diff.additions = additions as u32;
                file_diff.deletions = deletions as u32;

                for hunk_idx in 0..patch.num_hunks() {
                    if let Ok((hunk, _)) = patch.hunk(hunk_idx) {
                        let mut diff_hunk = DiffHunk {
                            header: String::from_utf8_lossy(hunk.header()).trim().to_string(),
                            old_start: hunk.old_start(),
                            old_lines: hunk.old_lines(),
                            new_start: hunk.new_start(),
                            new_lines: hunk.new_lines(),
                            lines: Vec::new(),
                        };

                        for line_idx in 0..patch.num_lines_in_hunk(hunk_idx).unwrap_or(0) {
                            if let Ok(line) = patch.line_in_hunk(hunk_idx, line_idx) {
                                let line_type = match line.origin() {
                                    '+' => "addition",
                                    '-' => "deletion",
                                    ' ' => "context",
                                    _ => "other",
                                };

                                diff_hunk.lines.push(DiffLine {
                                    line_type: line_type.to_string(),
                                    old_lineno: line.old_lineno(),
                                    new_lineno: line.new_lineno(),
                                    content: String::from_utf8_lossy(line.content()).to_string(),
                                });
                            }
                        }

                        file_diff.hunks.push(diff_hunk);
                    }
                }
            }
        }

        diffs.push(file_diff);
    }

    Ok(diffs)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommitDiff {
    pub commit_id: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub timestamp: String,
    pub files: Vec<FileDiff>,
    pub total_additions: u32,
    pub total_deletions: u32,
}

#[command]
pub async fn git_show_commit(repo_path: String, commit_id: String) -> Result<CommitDiff, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    // Use revparse_single to support both full and abbreviated commit hashes
    let object = repo.revparse_single(&commit_id)
        .map_err(|e| format!("Could not resolve commit '{}': {}", commit_id, e))?;
    
    let commit = object.peel_to_commit()
        .map_err(|e| format!("'{}' is not a valid commit: {}", commit_id, e))?;
    
    // Extract values before they go out of scope (borrow checker)
    let commit_message = commit.message().unwrap_or("").to_string();
    let author_name = commit.author().name().unwrap_or("Unknown").to_string();
    let author_email = commit.author().email().unwrap_or("").to_string();
    let timestamp = chrono::DateTime::from_timestamp(commit.time().seconds(), 0)
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
        .unwrap_or_default();
    
    let tree = commit.tree()
        .map_err(|e| format!("Failed to get commit tree: {}", e))?;
    
    let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
    
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
        .map_err(|e| format!("Failed to create diff: {}", e))?;
    
    let mut files: Vec<FileDiff> = Vec::new();
    let mut total_additions = 0u32;
    let mut total_deletions = 0u32;
    
    for (idx, delta) in diff.deltas().enumerate() {
        let mut file_diff = FileDiff {
            old_path: delta.old_file().path().map(|p| p.to_string_lossy().to_string()),
            new_path: delta.new_file().path().map(|p| p.to_string_lossy().to_string()),
            status: match delta.status() {
                git2::Delta::Added => "added",
                git2::Delta::Deleted => "deleted",
                git2::Delta::Modified => "modified",
                git2::Delta::Renamed => "renamed",
                git2::Delta::Copied => "copied",
                _ => "unknown",
            }.to_string(),
            hunks: Vec::new(),
            additions: 0,
            deletions: 0,
        };
        
        if let Ok(Some(patch)) = git2::Patch::from_diff(&diff, idx) {
            let (_, additions, deletions) = patch.line_stats().unwrap_or((0, 0, 0));
            file_diff.additions = additions as u32;
            file_diff.deletions = deletions as u32;
            total_additions += additions as u32;
            total_deletions += deletions as u32;
            
            for hunk_idx in 0..patch.num_hunks() {
                if let Ok((hunk, _)) = patch.hunk(hunk_idx) {
                    let mut diff_hunk = DiffHunk {
                        header: String::from_utf8_lossy(hunk.header()).trim().to_string(),
                        old_start: hunk.old_start(),
                        old_lines: hunk.old_lines(),
                        new_start: hunk.new_start(),
                        new_lines: hunk.new_lines(),
                        lines: Vec::new(),
                    };
                    
                    for line_idx in 0..patch.num_lines_in_hunk(hunk_idx).unwrap_or(0) {
                        if let Ok(line) = patch.line_in_hunk(hunk_idx, line_idx) {
                            let line_type = match line.origin() {
                                '+' => "addition",
                                '-' => "deletion",
                                ' ' => "context",
                                _ => "other",
                            };
                            
                            diff_hunk.lines.push(DiffLine {
                                line_type: line_type.to_string(),
                                old_lineno: line.old_lineno(),
                                new_lineno: line.new_lineno(),
                                content: String::from_utf8_lossy(line.content()).to_string(),
                            });
                        }
                    }
                    
                    file_diff.hunks.push(diff_hunk);
                }
            }
        }
        
        files.push(file_diff);
    }
    
    Ok(CommitDiff {
        commit_id: commit.id().to_string(),
        message: commit_message,
        author: author_name,
        email: author_email,
        timestamp,
        files,
        total_additions,
        total_deletions,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffSinceResult {
    pub from_commit: String,
    pub to_commit: String,
    pub commit_count: usize,
    pub files: Vec<FileDiff>,
    pub total_additions: u32,
    pub total_deletions: u32,
}

#[command]
pub async fn git_diff_since(repo_path: String, commit_id: String) -> Result<DiffSinceResult, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    // Parse the "since" commit - use revparse_single to support both full and abbreviated hashes
    let from_object = repo.revparse_single(&commit_id)
        .map_err(|e| format!("Could not resolve commit '{}': {}", commit_id, e))?;
    
    let from_commit = from_object.peel_to_commit()
        .map_err(|e| format!("'{}' is not a valid commit: {}", commit_id, e))?;
    
    let from_oid = from_commit.id();
    
    // Get HEAD commit
    let head = repo.head()
        .map_err(|e| format!("Failed to get HEAD: {}", e))?;
    let head_commit = head.peel_to_commit()
        .map_err(|e| format!("Failed to get HEAD commit: {}", e))?;
    
    let to_oid = head_commit.id();
    
    // Count commits between from and HEAD
    let mut revwalk = repo.revwalk()
        .map_err(|e| format!("Failed to create revwalk: {}", e))?;
    revwalk.push(to_oid)
        .map_err(|e| format!("Failed to push HEAD: {}", e))?;
    revwalk.hide(from_oid)
        .map_err(|e| format!("Failed to hide from commit: {}", e))?;
    let commit_count = revwalk.count();
    
    // Get the trees for diff
    let from_tree = from_commit.tree()
        .map_err(|e| format!("Failed to get from commit tree: {}", e))?;
    let to_tree = head_commit.tree()
        .map_err(|e| format!("Failed to get HEAD tree: {}", e))?;
    
    // Create diff between the two trees
    let diff = repo.diff_tree_to_tree(Some(&from_tree), Some(&to_tree), None)
        .map_err(|e| format!("Failed to create diff: {}", e))?;
    
    let mut files: Vec<FileDiff> = Vec::new();
    let mut total_additions = 0u32;
    let mut total_deletions = 0u32;
    
    for (idx, delta) in diff.deltas().enumerate() {
        let mut file_diff = FileDiff {
            old_path: delta.old_file().path().map(|p| p.to_string_lossy().to_string()),
            new_path: delta.new_file().path().map(|p| p.to_string_lossy().to_string()),
            status: match delta.status() {
                git2::Delta::Added => "added",
                git2::Delta::Deleted => "deleted",
                git2::Delta::Modified => "modified",
                git2::Delta::Renamed => "renamed",
                git2::Delta::Copied => "copied",
                _ => "unknown",
            }.to_string(),
            hunks: Vec::new(),
            additions: 0,
            deletions: 0,
        };
        
        if let Ok(Some(patch)) = git2::Patch::from_diff(&diff, idx) {
            let (_, additions, deletions) = patch.line_stats().unwrap_or((0, 0, 0));
            file_diff.additions = additions as u32;
            file_diff.deletions = deletions as u32;
            total_additions += additions as u32;
            total_deletions += deletions as u32;
            
            for hunk_idx in 0..patch.num_hunks() {
                if let Ok((hunk, _)) = patch.hunk(hunk_idx) {
                    let mut diff_hunk = DiffHunk {
                        header: String::from_utf8_lossy(hunk.header()).trim().to_string(),
                        old_start: hunk.old_start(),
                        old_lines: hunk.old_lines(),
                        new_start: hunk.new_start(),
                        new_lines: hunk.new_lines(),
                        lines: Vec::new(),
                    };
                    
                    for line_idx in 0..patch.num_lines_in_hunk(hunk_idx).unwrap_or(0) {
                        if let Ok(line) = patch.line_in_hunk(hunk_idx, line_idx) {
                            let line_type = match line.origin() {
                                '+' => "addition",
                                '-' => "deletion",
                                ' ' => "context",
                                _ => "other",
                            };
                            
                            diff_hunk.lines.push(DiffLine {
                                line_type: line_type.to_string(),
                                old_lineno: line.old_lineno(),
                                new_lineno: line.new_lineno(),
                                content: String::from_utf8_lossy(line.content()).to_string(),
                            });
                        }
                    }
                    
                    file_diff.hunks.push(diff_hunk);
                }
            }
        }
        
        files.push(file_diff);
    }
    
    Ok(DiffSinceResult {
        from_commit: from_oid.to_string(),
        to_commit: to_oid.to_string(),
        commit_count,
        files,
        total_additions,
        total_deletions,
    })
}

fn get_credentials_callback() -> RemoteCallbacks<'static> {
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(|_url, username_from_url, allowed_types| {
        if allowed_types.contains(git2::CredentialType::SSH_KEY) {
            let username = username_from_url.unwrap_or("git");
            // Try SSH agent first, then default SSH key
            if let Ok(cred) = Cred::ssh_key_from_agent(username) {
                return Ok(cred);
            }
            // Fall back to default SSH key location
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
            let ssh_key = Path::new(&home).join(".ssh").join("id_rsa");
            let ssh_key_ed = Path::new(&home).join(".ssh").join("id_ed25519");
            
            if ssh_key_ed.exists() {
                Cred::ssh_key(username, None, &ssh_key_ed, None)
            } else if ssh_key.exists() {
                Cred::ssh_key(username, None, &ssh_key, None)
            } else {
                Cred::ssh_key_from_agent(username)
            }
        } else if allowed_types.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            Cred::default()
        } else {
            Cred::default()
        }
    });
    callbacks
}

#[command]
pub async fn git_fetch(repo_path: String, remote_name: Option<String>) -> Result<(), String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let remote_name = remote_name.unwrap_or_else(|| "origin".to_string());
    let mut remote = repo.find_remote(&remote_name)
        .map_err(|e| format!("Failed to find remote '{}': {}", remote_name, e))?;
    
    let callbacks = get_credentials_callback();
    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);
    
    let refspecs: &[&str] = &[];
    remote.fetch(refspecs, Some(&mut fetch_options), None)
        .map_err(|e| format!("Failed to fetch: {}", e))?;
    
    Ok(())
}

#[command]
pub async fn git_pull(repo_path: String, remote_name: Option<String>) -> Result<String, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let remote_name = remote_name.unwrap_or_else(|| "origin".to_string());
    
    // Get current branch name
    let head = repo.head()
        .map_err(|e| format!("Failed to get HEAD: {}", e))?;
    let branch_name = head.shorthand()
        .ok_or_else(|| "Failed to get branch name".to_string())?;
    
    // Fetch first
    {
        let mut remote = repo.find_remote(&remote_name)
            .map_err(|e| format!("Failed to find remote '{}': {}", remote_name, e))?;
        
        let callbacks = get_credentials_callback();
        let mut fetch_options = FetchOptions::new();
        fetch_options.remote_callbacks(callbacks);
        
        let refspecs: &[&str] = &[];
        remote.fetch(refspecs, Some(&mut fetch_options), None)
            .map_err(|e| format!("Failed to fetch: {}", e))?;
    }
    
    // Get the fetch head
    let fetch_head = repo.find_reference(&format!("refs/remotes/{}/{}", remote_name, branch_name))
        .map_err(|e| format!("Failed to find remote tracking branch: {}", e))?;
    
    let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)
        .map_err(|e| format!("Failed to get fetch commit: {}", e))?;
    
    // Perform merge analysis
    let (analysis, _) = repo.merge_analysis(&[&fetch_commit])
        .map_err(|e| format!("Failed to analyze merge: {}", e))?;
    
    if analysis.is_up_to_date() {
        return Ok("Already up to date".to_string());
    }
    
    if analysis.is_fast_forward() {
        // Fast-forward merge
        let refname = format!("refs/heads/{}", branch_name);
        let mut reference = repo.find_reference(&refname)
            .map_err(|e| format!("Failed to find reference: {}", e))?;
        
        reference.set_target(fetch_commit.id(), "Fast-forward pull")
            .map_err(|e| format!("Failed to fast-forward: {}", e))?;
        
        repo.set_head(&refname)
            .map_err(|e| format!("Failed to set HEAD: {}", e))?;
        
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
            .map_err(|e| format!("Failed to checkout: {}", e))?;
        
        return Ok("Fast-forward merge completed".to_string());
    }
    
    // Normal merge required
    repo.merge(&[&fetch_commit], None, None)
        .map_err(|e| format!("Failed to merge: {}", e))?;
    
    // Check for conflicts
    let mut index = repo.index()
        .map_err(|e| format!("Failed to get index: {}", e))?;
    
    if index.has_conflicts() {
        return Err("Merge conflicts detected. Please resolve manually.".to_string());
    }
    
    // Create merge commit
    let sig = repo.signature()
        .or_else(|_| Signature::now("OpenIDE User", "user@openide.local"))
        .map_err(|e| format!("Failed to create signature: {}", e))?;
    
    let tree_id = index.write_tree()
        .map_err(|e| format!("Failed to write tree: {}", e))?;
    let tree = repo.find_tree(tree_id)
        .map_err(|e| format!("Failed to find tree: {}", e))?;
    
    let head_commit = head.peel_to_commit()
        .map_err(|e| format!("Failed to get HEAD commit: {}", e))?;
    let fetch_commit_obj = repo.find_commit(fetch_commit.id())
        .map_err(|e| format!("Failed to find fetch commit: {}", e))?;
    
    let message = format!("Merge branch '{}' of {} into {}", branch_name, remote_name, branch_name);
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &message,
        &tree,
        &[&head_commit, &fetch_commit_obj],
    ).map_err(|e| format!("Failed to create merge commit: {}", e))?;
    
    // Clean up merge state
    repo.cleanup_state()
        .map_err(|e| format!("Failed to cleanup state: {}", e))?;
    
    Ok("Merge completed".to_string())
}

#[command]
pub async fn git_push(repo_path: String, remote_name: Option<String>, force: Option<bool>) -> Result<String, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let remote_name = remote_name.unwrap_or_else(|| "origin".to_string());
    let force = force.unwrap_or(false);
    
    // Get current branch
    let head = repo.head()
        .map_err(|e| format!("Failed to get HEAD: {}", e))?;
    let branch_name = head.shorthand()
        .ok_or_else(|| "Failed to get branch name".to_string())?;
    
    let mut remote = repo.find_remote(&remote_name)
        .map_err(|e| format!("Failed to find remote '{}': {}", remote_name, e))?;
    
    let callbacks = get_credentials_callback();
    let mut push_options = PushOptions::new();
    push_options.remote_callbacks(callbacks);
    
    let refspec = if force {
        format!("+refs/heads/{}:refs/heads/{}", branch_name, branch_name)
    } else {
        format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name)
    };
    
    remote.push(&[&refspec], Some(&mut push_options))
        .map_err(|e| format!("Failed to push: {}", e))?;
    
    Ok(format!("Pushed to {}/{}", remote_name, branch_name))
}

#[command]
pub async fn git_create_branch(repo_path: String, branch_name: String, checkout: Option<bool>) -> Result<(), String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let checkout = checkout.unwrap_or(true);
    
    // Get HEAD commit
    let head = repo.head()
        .map_err(|e| format!("Failed to get HEAD: {}", e))?;
    let head_commit = head.peel_to_commit()
        .map_err(|e| format!("Failed to get HEAD commit: {}", e))?;
    
    // Create the branch
    repo.branch(&branch_name, &head_commit, false)
        .map_err(|e| format!("Failed to create branch: {}", e))?;
    
    // Checkout if requested
    if checkout {
        let obj = repo.revparse_single(&format!("refs/heads/{}", branch_name))
            .map_err(|e| format!("Failed to find branch: {}", e))?;
        
        repo.checkout_tree(&obj, None)
            .map_err(|e| format!("Failed to checkout: {}", e))?;
        
        repo.set_head(&format!("refs/heads/{}", branch_name))
            .map_err(|e| format!("Failed to set HEAD: {}", e))?;
    }
    
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemoteInfo {
    pub name: String,
    pub url: Option<String>,
}

#[command]
pub async fn git_remotes(repo_path: String) -> Result<Vec<RemoteInfo>, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let remotes = repo.remotes()
        .map_err(|e| format!("Failed to get remotes: {}", e))?;
    
    let mut result = Vec::new();
    for remote_name in remotes.iter().flatten() {
        if let Ok(remote) = repo.find_remote(remote_name) {
            result.push(RemoteInfo {
                name: remote_name.to_string(),
                url: remote.url().map(String::from),
            });
        }
    }
    
    Ok(result)
}

#[command]
pub async fn git_delete_branch(repo_path: String, branch_name: String, force: Option<bool>) -> Result<(), String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let force = force.unwrap_or(false);
    
    // Get current branch to prevent deleting it
    let head = repo.head()
        .map_err(|e| format!("Failed to get HEAD: {}", e))?;
    let current_branch = head.shorthand().unwrap_or("");
    
    if current_branch == branch_name {
        return Err("Cannot delete the currently checked out branch".to_string());
    }
    
    let mut branch = repo.find_branch(&branch_name, BranchType::Local)
        .map_err(|e| format!("Failed to find branch '{}': {}", branch_name, e))?;
    
    if force {
        branch.delete()
            .map_err(|e| format!("Failed to delete branch: {}", e))?;
    } else {
        // Check if branch is merged before deleting
        let head_commit = head.peel_to_commit()
            .map_err(|e| format!("Failed to get HEAD commit: {}", e))?;
        let branch_commit = branch.get().peel_to_commit()
            .map_err(|e| format!("Failed to get branch commit: {}", e))?;
        
        let merge_base = repo.merge_base(head_commit.id(), branch_commit.id());
        if merge_base.is_err() || merge_base.unwrap() != branch_commit.id() {
            return Err("Branch is not fully merged. Use force delete to remove anyway.".to_string());
        }
        
        branch.delete()
            .map_err(|e| format!("Failed to delete branch: {}", e))?;
    }
    
    Ok(())
}

#[command]
pub async fn git_discard_changes(repo_path: String, file_path: String) -> Result<(), String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let path = std::path::Path::new(&file_path);
    
    // Check if file is untracked
    let mut status_opts = StatusOptions::new();
    status_opts.pathspec(&file_path);
    let statuses = repo.statuses(Some(&mut status_opts))
        .map_err(|e| format!("Failed to get status: {}", e))?;
    
    if let Some(entry) = statuses.iter().next() {
        if entry.status().is_wt_new() {
            // Untracked file - delete it
            let full_path = std::path::Path::new(&repo_path).join(&file_path);
            std::fs::remove_file(&full_path)
                .map_err(|e| format!("Failed to delete untracked file: {}", e))?;
            return Ok(());
        }
    }
    
    // Restore from HEAD
    let head = repo.head()
        .map_err(|e| format!("Failed to get HEAD: {}", e))?;
    let tree = head.peel_to_tree()
        .map_err(|e| format!("Failed to get tree: {}", e))?;
    
    let mut checkout_builder = git2::build::CheckoutBuilder::new();
    checkout_builder.path(path);
    checkout_builder.force();
    
    repo.checkout_tree(tree.as_object(), Some(&mut checkout_builder))
        .map_err(|e| format!("Failed to discard changes: {}", e))?;
    
    Ok(())
}

#[command]
pub async fn git_stash(repo_path: String, message: Option<String>) -> Result<String, String> {
    let mut repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let signature = repo.signature()
        .or_else(|_| Signature::now("OpenIDE User", "user@openide.local"))
        .map_err(|e| format!("Failed to create signature: {}", e))?;
    
    let message = message.as_deref();
    
    let stash_id = repo.stash_save(&signature, message.unwrap_or("WIP"), None)
        .map_err(|e| format!("Failed to stash changes: {}", e))?;
    
    Ok(stash_id.to_string())
}

#[command]
pub async fn git_stash_pop(repo_path: String, index: Option<usize>) -> Result<(), String> {
    let mut repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let index = index.unwrap_or(0);
    
    repo.stash_pop(index, None)
        .map_err(|e| format!("Failed to pop stash: {}", e))?;
    
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
}

#[command]
pub async fn git_stash_list(repo_path: String) -> Result<Vec<StashEntry>, String> {
    let mut repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    let mut stashes = Vec::new();
    
    repo.stash_foreach(|index, message, _oid| {
        stashes.push(StashEntry {
            index,
            message: message.to_string(),
        });
        true
    }).map_err(|e| format!("Failed to list stashes: {}", e))?;
    
    Ok(stashes)
}

#[command]
pub async fn git_stash_drop(repo_path: String, index: usize) -> Result<(), String> {
    let mut repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repository: {}", e))?;
    
    repo.stash_drop(index)
        .map_err(|e| format!("Failed to drop stash: {}", e))?;
    
    Ok(())
}
