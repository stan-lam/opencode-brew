use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::command;
use std::time::Duration;

const GITLAB_API_BASE: &str = "https://gitlab.com/api/v4";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitLabMergeRequest {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub updated_at: String,
    pub head_ref: String,
    pub base_ref: String,
    pub draft: bool,
}

#[derive(Debug, Deserialize)]
struct GitLabUser {
    username: String,
}

#[derive(Debug, Deserialize)]
struct GitLabMergeRequestApi {
    iid: u64,
    title: String,
    author: GitLabUser,
    updated_at: String,
    source_branch: String,
    target_branch: String,
    draft: Option<bool>,
    work_in_progress: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct GitLabMergeRequestChanges {
    changes: Vec<GitLabMergeRequestChange>,
}

#[derive(Debug, Deserialize)]
struct GitLabMergeRequestChange {
    old_path: String,
    new_path: String,
    diff: String,
}

fn create_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("OpenCodeBrew")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create GitLab client: {}", e))
}

fn ensure_token(token: &str) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("GitLab token is required".to_string());
    }
    Ok(())
}

fn normalize_api_base(api_base: Option<String>) -> String {
    let base = api_base.unwrap_or_else(|| GITLAB_API_BASE.to_string());
    base.trim_end_matches('/').to_string()
}

fn encode_project(owner: &str, repo: &str) -> String {
    let project = format!("{}/{}", owner, repo);
    urlencoding::encode(&project).to_string()
}

#[command]
pub async fn gitlab_list_merge_requests(
    owner: String,
    repo: String,
    token: String,
    api_base: Option<String>,
) -> Result<Vec<GitLabMergeRequest>, String> {
    ensure_token(&token)?;
    let client = create_client()?;
    let api_base = normalize_api_base(api_base);
    let project = encode_project(&owner, &repo);
    let url = format!(
        "{}/projects/{}/merge_requests?state=opened&per_page=50",
        api_base, project
    );
    let response = client
        .get(url)
        .header("PRIVATE-TOKEN", token)
        .send()
        .await
        .map_err(|e| format!("GitLab request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitLab API failed with status: {}",
            response.status()
        ));
    }

    let merge_requests: Vec<GitLabMergeRequestApi> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitLab response: {}", e))?;

    Ok(merge_requests
        .into_iter()
        .map(|mr| GitLabMergeRequest {
            number: mr.iid,
            title: mr.title,
            author: mr.author.username,
            updated_at: mr.updated_at,
            head_ref: mr.source_branch,
            base_ref: mr.target_branch,
            draft: mr.draft.unwrap_or(false) || mr.work_in_progress.unwrap_or(false),
        })
        .collect())
}

#[command]
pub async fn gitlab_merge_request_diff(
    owner: String,
    repo: String,
    mr_number: u64,
    token: String,
    api_base: Option<String>,
) -> Result<String, String> {
    ensure_token(&token)?;
    let client = create_client()?;
    let api_base = normalize_api_base(api_base);
    let project = encode_project(&owner, &repo);
    let url = format!(
        "{}/projects/{}/merge_requests/{}/changes",
        api_base, project, mr_number
    );
    let response = client
        .get(url)
        .header("PRIVATE-TOKEN", token)
        .send()
        .await
        .map_err(|e| format!("GitLab request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitLab API failed with status: {}",
            response.status()
        ));
    }

    let changes: GitLabMergeRequestChanges = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitLab response: {}", e))?;

    let diff = changes
        .changes
        .into_iter()
        .map(|change| {
            let header = format!(
                "diff --git a/{old} b/{new}\n--- a/{old}\n+++ b/{new}\n",
                old = change.old_path,
                new = change.new_path
            );
            format!("{}{}", header, change.diff)
        })
        .collect::<Vec<String>>()
        .join("\n\n");

    Ok(diff)
}
