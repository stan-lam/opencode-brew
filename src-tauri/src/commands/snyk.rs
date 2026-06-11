use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnykVulnerability {
    pub id: String,
    pub title: String,
    pub severity: String,
    #[serde(rename = "packageName")]
    pub package_name: String,
    pub version: String,
    #[serde(rename = "fixedIn")]
    pub fixed_in: Option<String>,
    pub description: String,
    #[serde(rename = "cvssScore")]
    pub cvss_score: Option<f32>,
    #[serde(rename = "exploitMaturity")]
    pub exploit_maturity: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnykSummary {
    #[serde(rename = "totalVulnerabilities")]
    pub total_vulnerabilities: u32,
    #[serde(rename = "criticalCount")]
    pub critical_count: u32,
    #[serde(rename = "highCount")]
    pub high_count: u32,
    #[serde(rename = "mediumCount")]
    pub medium_count: u32,
    #[serde(rename = "lowCount")]
    pub low_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnykScanResult {
    pub ok: bool,
    pub vulnerabilities: Vec<SnykVulnerability>,
    pub summary: SnykSummary,
    pub error: Option<String>,
    #[serde(rename = "projectName")]
    pub project_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SnykJsonVuln {
    id: Option<String>,
    title: Option<String>,
    severity: Option<String>,
    #[serde(rename = "packageName")]
    package_name: Option<String>,
    version: Option<String>,
    #[serde(rename = "fixedIn")]
    fixed_in: Option<Vec<String>>,
    description: Option<String>,
    #[serde(rename = "cvssScore")]
    cvss_score: Option<f32>,
    #[serde(rename = "exploit")]
    exploit_maturity: Option<String>,
    #[serde(rename = "identifiers")]
    identifiers: Option<SnykIdentifiers>,
}

#[derive(Debug, Deserialize)]
struct SnykIdentifiers {
    #[serde(rename = "CVE")]
    cve: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct SnykJsonOutput {
    ok: Option<bool>,
    vulnerabilities: Option<Vec<SnykJsonVuln>>,
    #[serde(rename = "projectName")]
    project_name: Option<String>,
    error: Option<String>,
    #[serde(rename = "userMessage")]
    user_message: Option<String>,
}

fn parse_snyk_output(output: &str) -> Result<SnykScanResult, String> {
    let json: SnykJsonOutput = serde_json::from_str(output)
        .map_err(|e| format!("Failed to parse Snyk JSON output: {}", e))?;

    if let Some(error) = json.error {
        return Ok(SnykScanResult {
            ok: false,
            vulnerabilities: vec![],
            summary: SnykSummary {
                total_vulnerabilities: 0,
                critical_count: 0,
                high_count: 0,
                medium_count: 0,
                low_count: 0,
            },
            error: Some(json.user_message.unwrap_or(error)),
            project_name: json.project_name,
        });
    }

    let vulns = json.vulnerabilities.unwrap_or_default();
    let mut critical_count = 0u32;
    let mut high_count = 0u32;
    let mut medium_count = 0u32;
    let mut low_count = 0u32;

    let vulnerabilities: Vec<SnykVulnerability> = vulns
        .into_iter()
        .map(|v| {
            let severity = v.severity.clone().unwrap_or_else(|| "low".to_string()).to_lowercase();
            match severity.as_str() {
                "critical" => critical_count += 1,
                "high" => high_count += 1,
                "medium" => medium_count += 1,
                _ => low_count += 1,
            }

            let snyk_id = v.id.clone().unwrap_or_default();
            let url = if !snyk_id.is_empty() {
                Some(format!("https://security.snyk.io/vuln/{}", snyk_id))
            } else {
                None
            };

            SnykVulnerability {
                id: snyk_id,
                title: v.title.unwrap_or_else(|| "Unknown vulnerability".to_string()),
                severity,
                package_name: v.package_name.unwrap_or_else(|| "unknown".to_string()),
                version: v.version.unwrap_or_else(|| "unknown".to_string()),
                fixed_in: v.fixed_in.and_then(|versions| versions.first().cloned()),
                description: v.description.unwrap_or_default(),
                cvss_score: v.cvss_score,
                exploit_maturity: v.exploit_maturity,
                url,
            }
        })
        .collect();

    let total = vulnerabilities.len() as u32;

    Ok(SnykScanResult {
        ok: json.ok.unwrap_or(total == 0),
        vulnerabilities,
        summary: SnykSummary {
            total_vulnerabilities: total,
            critical_count,
            high_count,
            medium_count,
            low_count,
        },
        error: None,
        project_name: json.project_name,
    })
}

#[command]
pub async fn snyk_scan(
    workspace_path: String,
    cli_path: Option<String>,
    auth_token: Option<String>,
) -> Result<SnykScanResult, String> {
    let snyk_cmd = cli_path.unwrap_or_else(|| "snyk".to_string());
    
    let mut cmd = Command::new(&snyk_cmd);
    cmd.arg("test");
    cmd.arg("--json");
    cmd.current_dir(&workspace_path);

    if let Some(token) = auth_token {
        if !token.is_empty() {
            cmd.env("SNYK_TOKEN", token);
        }
    }

    let output = cmd.output();

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            if stdout.is_empty() && !stderr.is_empty() {
                if stderr.contains("command not found") || stderr.contains("not recognized") {
                    return Ok(SnykScanResult {
                        ok: false,
                        vulnerabilities: vec![],
                        summary: SnykSummary {
                            total_vulnerabilities: 0,
                            critical_count: 0,
                            high_count: 0,
                            medium_count: 0,
                            low_count: 0,
                        },
                        error: Some("Snyk CLI not found. Install it with: npm install -g snyk".to_string()),
                        project_name: None,
                    });
                }
                return Ok(SnykScanResult {
                    ok: false,
                    vulnerabilities: vec![],
                    summary: SnykSummary {
                        total_vulnerabilities: 0,
                        critical_count: 0,
                        high_count: 0,
                        medium_count: 0,
                        low_count: 0,
                    },
                    error: Some(stderr.to_string()),
                    project_name: None,
                });
            }

            parse_snyk_output(&stdout)
        }
        Err(e) => {
            let error_msg = if e.kind() == std::io::ErrorKind::NotFound {
                "Snyk CLI not found. Install it with: npm install -g snyk".to_string()
            } else {
                format!("Failed to execute Snyk: {}", e)
            };

            Ok(SnykScanResult {
                ok: false,
                vulnerabilities: vec![],
                summary: SnykSummary {
                    total_vulnerabilities: 0,
                    critical_count: 0,
                    high_count: 0,
                    medium_count: 0,
                    low_count: 0,
                },
                error: Some(error_msg),
                project_name: None,
            })
        }
    }
}

#[command]
pub async fn snyk_check_installed(cli_path: Option<String>) -> Result<bool, String> {
    let snyk_cmd = cli_path.unwrap_or_else(|| "snyk".to_string());
    
    let output = Command::new(&snyk_cmd)
        .arg("--version")
        .output();

    match output {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false),
    }
}
