use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use tauri::command;
use std::time::Duration;

const GITHUB_API_BASE: &str = "https://api.github.com";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubPullRequest {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub updated_at: String,
    pub head_ref: String,
    pub base_ref: String,
    pub draft: bool,
}

#[derive(Debug, Deserialize)]
struct GitHubUser {
    login: String,
}

#[derive(Debug, Deserialize)]
struct GitHubRef {
    #[serde(rename = "ref")]
    ref_name: String,
}

#[derive(Debug, Deserialize)]
struct GitHubPullRequestApi {
    number: u64,
    title: String,
    user: GitHubUser,
    updated_at: String,
    head: GitHubRef,
    base: GitHubRef,
    draft: Option<bool>,
}

fn create_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("OpenCodeBrew")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create GitHub client: {}", e))
}

fn ensure_token(token: &str) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("GitHub token is required".to_string());
    }
    Ok(())
}

fn normalize_api_base(api_base: Option<String>) -> String {
    let base = api_base.unwrap_or_else(|| GITHUB_API_BASE.to_string());
    base.trim_end_matches('/').to_string()
}

async fn send_github_request(
    client: &Client,
    url: &str,
    token: &str,
    accept: &str,
) -> Result<reqwest::Response, String> {
    let response = client
        .get(url)
        .bearer_auth(token)
        .header("Accept", accept)
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("GitHub request failed: {}", e))?;

    if response.status() != StatusCode::UNAUTHORIZED {
        return Ok(response);
    }

    client
        .get(url)
        .header("Authorization", format!("token {}", token))
        .header("Accept", accept)
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("GitHub request failed: {}", e))
}

#[command]
pub async fn github_list_pull_requests(
    owner: String,
    repo: String,
    token: String,
    api_base: Option<String>,
) -> Result<Vec<GithubPullRequest>, String> {
    ensure_token(&token)?;
    let client = create_client()?;
    let api_base = normalize_api_base(api_base);
    let url = format!(
        "{}/repos/{}/{}/pulls?state=open&per_page=50",
        api_base, owner, repo
    );
    let response = send_github_request(
        &client,
        &url,
        &token,
        "application/vnd.github+json",
    )
    .await?;

    let status = response.status();
    if !status.is_success() {
        if status == StatusCode::NOT_FOUND {
            return Err("GitHub API 404: repo not found or token lacks access. For fine-grained PATs, ensure the org repo is selected and SSO-authorized.".to_string());
        }
        if status == StatusCode::UNAUTHORIZED {
            return Err("GitHub API 401: token not authorized. Ensure the PAT is valid and SSO-authorized for this org.".to_string());
        }
        return Err(format!(
            "GitHub API failed with status: {}",
            status
        ));
    }

    let prs: Vec<GitHubPullRequestApi> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub response: {}", e))?;

    Ok(prs
        .into_iter()
        .map(|pr| GithubPullRequest {
            number: pr.number,
            title: pr.title,
            author: pr.user.login,
            updated_at: pr.updated_at,
            head_ref: pr.head.ref_name,
            base_ref: pr.base.ref_name,
            draft: pr.draft.unwrap_or(false),
        })
        .collect())
}

#[command]
pub async fn github_pull_request_diff(
    owner: String,
    repo: String,
    pr_number: u64,
    token: String,
    api_base: Option<String>,
) -> Result<String, String> {
    ensure_token(&token)?;
    let client = create_client()?;
    let api_base = normalize_api_base(api_base);
    let url = format!(
        "{}/repos/{}/{}/pulls/{}",
        api_base, owner, repo, pr_number
    );
    let response = send_github_request(
        &client,
        &url,
        &token,
        "application/vnd.github.v3.diff",
    )
    .await?;

    let status = response.status();
    if !status.is_success() {
        if status == StatusCode::NOT_FOUND {
            return Err("GitHub API 404: PR not found or token lacks access. Verify repo access and PR number.".to_string());
        }
        if status == StatusCode::UNAUTHORIZED {
            return Err("GitHub API 401: token not authorized. Ensure the PAT is valid and SSO-authorized for this org.".to_string());
        }
        return Err(format!(
            "GitHub API failed with status: {}",
            status
        ));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Failed to read GitHub diff: {}", e))
}
