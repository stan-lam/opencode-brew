use reqwest::Client;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use tauri::command;
use std::time::Duration;
use chrono::Datelike;
use chromiumoxide::{Browser, BrowserConfig};
use futures::StreamExt;
use tokio::time::timeout;

const BROWSER_ERROR_MSG: &str = "Please ensure Chrome, Edge, or Chromium is installed. \
On Windows, Edge is usually pre-installed. On macOS/Linux, install Chrome or Chromium.";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebContent {
    pub url: String,
    pub title: String,
    pub content: String,
    pub content_type: String,
}

const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT_SECS: u64 = 15;
const MAX_CONTENT_LENGTH: usize = 8000;

// MLB API types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MLBTeamStanding {
    pub team_name: String,
    pub wins: i32,
    pub losses: i32,
    pub pct: String,
    pub games_back: String,
    pub division: String,
    pub league: String,
    pub streak: String,
    pub last_ten: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MLBStandings {
    pub season: i32,
    pub standings: Vec<MLBTeamStanding>,
}

fn create_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

#[command]
pub async fn get_mlb_standings(season: Option<i32>) -> Result<MLBStandings, String> {
    let client = create_client()?;
    let year = season.unwrap_or_else(|| {
        chrono::Local::now().year()
    });
    
    // MLB Stats API - 103 = American League, 104 = National League
    let url = format!(
        "https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season={}&standingsTypes=regularSeason",
        year
    );
    
    println!("[web::mlb] Fetching standings for {}: {}", year, url);
    
    let response = client
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("MLB API request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("MLB API failed with status: {}", response.status()));
    }
    
    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse MLB API response: {}", e))?;
    
    let mut standings = Vec::new();
    
    if let Some(records) = json.get("records").and_then(|r| r.as_array()) {
        for record in records {
            let division = record.get("division")
                .and_then(|d| d.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("Unknown")
                .to_string();
            
            let league = record.get("league")
                .and_then(|l| l.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("Unknown")
                .to_string();
            
            if let Some(team_records) = record.get("teamRecords").and_then(|t| t.as_array()) {
                for team_record in team_records {
                    let team_name = team_record.get("team")
                        .and_then(|t| t.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("Unknown")
                        .to_string();
                    
                    let wins = team_record.get("wins")
                        .and_then(|w| w.as_i64())
                        .unwrap_or(0) as i32;
                    
                    let losses = team_record.get("losses")
                        .and_then(|l| l.as_i64())
                        .unwrap_or(0) as i32;
                    
                    let pct = team_record.get("winningPercentage")
                        .and_then(|p| p.as_str())
                        .unwrap_or("0.000")
                        .to_string();
                    
                    let games_back = team_record.get("gamesBack")
                        .and_then(|g| g.as_str())
                        .unwrap_or("-")
                        .to_string();
                    
                    let streak_code = team_record.get("streak")
                        .and_then(|s| s.get("streakCode"))
                        .and_then(|c| c.as_str())
                        .unwrap_or("-")
                        .to_string();
                    
                    let last_ten = team_record.get("records")
                        .and_then(|r| r.get("splitRecords"))
                        .and_then(|s| s.as_array())
                        .and_then(|arr| arr.iter().find(|r| {
                            r.get("type").and_then(|t| t.as_str()) == Some("lastTen")
                        }))
                        .map(|r| {
                            let w = r.get("wins").and_then(|w| w.as_i64()).unwrap_or(0);
                            let l = r.get("losses").and_then(|l| l.as_i64()).unwrap_or(0);
                            format!("{}-{}", w, l)
                        })
                        .unwrap_or("-".to_string());
                    
                    standings.push(MLBTeamStanding {
                        team_name,
                        wins,
                        losses,
                        pct,
                        games_back,
                        division: division.clone(),
                        league: league.clone(),
                        streak: streak_code,
                        last_ten,
                    });
                }
            }
        }
    }
    
    println!("[web::mlb] Found {} teams", standings.len());
    
    Ok(MLBStandings {
        season: year,
        standings,
    })
}

// Search the web using multiple sources IN PARALLEL
// First successful result wins, others are canceled
// Tier 1 (fast): Brave API, Bing, DuckDuckGo, Google - race in parallel
// Tier 2 (slow): Headless browser, Lynx - sequential fallback only if Tier 1 fails
#[command]
pub async fn search_web(query: String, max_results: Option<u32>) -> Result<Vec<SearchResult>, String> {
    let max = max_results.unwrap_or(5).min(10) as usize;
    let client = create_client()?;
    
    println!("[web::search_web] Searching for: {} (PARALLEL)", query);
    
    // Per-source timeout for fast sources
    let fast_timeout = Duration::from_secs(8);
    
    // Get Brave API key if available
    let brave_api_key = std::env::var("BRAVE_SEARCH_API_KEY").ok()
        .filter(|k| !k.is_empty());
    
    // Use a channel to receive results from parallel tasks
    let (tx, mut rx) = tokio::sync::mpsc::channel::<(String, Vec<SearchResult>)>(4);
    
    // TIER 1: Fast sources - race in parallel
    let fast_sources: Vec<(&str, bool)> = vec![
        ("Brave API", brave_api_key.is_some()),
        ("Bing", true),
        ("DuckDuckGo", true),
        ("Google", true),
    ];
    
    let mut spawned = 0;
    for (source_name, enabled) in fast_sources {
        if !enabled {
            continue;
        }
        
        let client = client.clone();
        let query = query.clone();
        let tx = tx.clone();
        let source_name = source_name.to_string();
        let api_key = brave_api_key.clone();
        
        tokio::spawn(async move {
            let result = match source_name.as_str() {
                "Brave API" => {
                    if let Some(key) = api_key {
                        timeout(fast_timeout, search_brave_api(&client, &query, max, &key)).await
                    } else {
                        return;
                    }
                }
                "Bing" => timeout(fast_timeout, search_bing(&client, &query, max)).await,
                "DuckDuckGo" => timeout(fast_timeout, search_duckduckgo(&client, &query, max)).await,
                "Google" => timeout(fast_timeout, search_google(&client, &query, max)).await,
                _ => return,
            };
            
            let results = match result {
                Ok(Ok(r)) if !r.is_empty() => {
                    println!("[web::search_web] {} found {} results", source_name, r.len());
                    r
                }
                Ok(Ok(_)) => {
                    println!("[web::search_web] {} returned empty results", source_name);
                    vec![]
                }
                Ok(Err(e)) => {
                    println!("[web::search_web] {} failed: {}", source_name, e);
                    vec![]
                }
                Err(_) => {
                    println!("[web::search_web] {} timed out", source_name);
                    vec![]
                }
            };
            
            let _ = tx.send((source_name, results)).await;
        });
        spawned += 1;
    }
    
    // Drop our sender so the channel closes when all tasks complete
    drop(tx);
    
    // Wait for first valid result from Tier 1
    let mut received = 0;
    while let Some((source, results)) = rx.recv().await {
        received += 1;
        if !results.is_empty() {
            println!("[web::search_web] Using {} results from {} (received {}/{} responses)", 
                results.len(), source, received, spawned);
            return Ok(results);
        }
    }
    
    println!("[web::search_web] All {} fast sources failed, trying slow fallbacks...", received);
    
    // TIER 2: Slow fallbacks - only if all fast sources failed
    // These are expensive (headless browser) so we run them sequentially
    let slow_timeout = Duration::from_secs(30);
    
    // Try headless browser
    println!("[web::search_web] Trying headless browser...");
    if let Ok(Ok(results)) = timeout(slow_timeout, search_with_headless_browser(&query, max)).await {
        if !results.is_empty() {
            println!("[web::search_web] Headless browser found {} results", results.len());
            return Ok(results);
        }
    }
    
    // Try text browser (lynx) as last resort
    println!("[web::search_web] Trying text browser (lynx)...");
    if let Ok(Ok(results)) = timeout(slow_timeout, search_with_text_browser(&query, max)).await {
        if !results.is_empty() {
            println!("[web::search_web] Lynx found {} results", results.len());
            return Ok(results);
        }
    }
    
    println!("[web::search_web] All sources failed, returning empty results");
    Ok(vec![])
}

async fn search_brave_api(client: &Client, query: &str, max: usize, api_key: &str) -> Result<Vec<SearchResult>, String> {
    let encoded_query = urlencoding::encode(query);
    let search_url = format!(
        "https://api.search.brave.com/res/v1/web/search?q={}&count={}",
        encoded_query,
        max
    );
    
    println!("[web::brave_api] Searching: {}", query);
    
    let response = client
        .get(&search_url)
        .header("Accept", "application/json")
        .header("X-Subscription-Token", api_key)
        .send()
        .await
        .map_err(|e| format!("Brave API request failed: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        println!("[web::brave_api] Failed with status: {}", status);
        return Err(format!("Brave API failed with status: {}", status));
    }
    
    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Brave API response: {}", e))?;
    
    let mut results = Vec::new();
    
    if let Some(web_results) = json.get("web").and_then(|w| w.get("results")).and_then(|r| r.as_array()) {
        for result in web_results.iter().take(max) {
            let title = result.get("title").and_then(|t| t.as_str()).unwrap_or_default().to_string();
            let url = result.get("url").and_then(|u| u.as_str()).unwrap_or_default().to_string();
            let snippet = result.get("description").and_then(|d| d.as_str()).unwrap_or_default().to_string();
            
            if !title.is_empty() && !url.is_empty() {
                results.push(SearchResult { title, url, snippet });
            }
        }
    }
    
    println!("[web::brave_api] Found {} results", results.len());
    Ok(results)
}

async fn search_with_headless_browser(query: &str, max: usize) -> Result<Vec<SearchResult>, String> {
    println!("[web::headless] Launching browser for: {}", query);
    
    // Configure headless Chrome
    let config = BrowserConfig::builder()
        .no_sandbox()
        .window_size(1920, 1080)
        .build()
        .map_err(|e| format!("Browser config error: {}", e))?;
    
    let (mut browser, mut handler) = Browser::launch(config)
        .await
        .map_err(|e| format!("Browser launch error: {}. {}", e, BROWSER_ERROR_MSG))?;
    
    // Spawn the browser handler
    let handle = tokio::spawn(async move {
        while let Some(_) = handler.next().await {}
    });
    
    // Try DuckDuckGo first (simpler HTML than Google)
    let search_url = format!(
        "https://duckduckgo.com/?q={}&t=h_&ia=web",
        urlencoding::encode(query)
    );
    
    println!("[web::headless] Navigating to: {}", search_url);
    
    let page = browser.new_page(&search_url)
        .await
        .map_err(|e| format!("Navigation error: {}", e))?;
    
    // Wait for page to load and JavaScript to execute
    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    
    // Debug: Get page title to verify load
    let title_js = "document.title";
    if let Ok(title_result) = page.evaluate(title_js).await {
        if let Ok(title) = title_result.into_value::<String>() {
            println!("[web::headless] Page title: {}", title);
        }
    }
    
    // Extract search results using JavaScript - try multiple selectors
    let js_code = r#"
        (() => {
            const results = [];
            
            // DuckDuckGo selectors
            let items = document.querySelectorAll('[data-testid="result"], .result, article[data-nrn="result"]');
            
            // If no DDG results, try Google selectors
            if (items.length === 0) {
                items = document.querySelectorAll('div.g, div[data-hveid], .MjjYud');
            }
            
            console.log('Found items:', items.length);
            
            for (const item of items) {
                // Try multiple title selectors
                const titleEl = item.querySelector('h2 a, h3, [data-testid="result-title-a"], .result__title a, a[data-testid="result-extras-url-link"]');
                // Try multiple link selectors  
                let linkEl = item.querySelector('a[href^="http"]:not([href*="duckduckgo"]):not([href*="google"])');
                if (!linkEl) {
                    linkEl = item.querySelector('a[data-testid="result-extras-url-link"], .result__url');
                }
                // Try multiple snippet selectors
                const snippetEl = item.querySelector('[data-result="snippet"], .result__snippet, .VwiC3b, span[data-testid="result-snippet"]');
                
                if (titleEl || linkEl) {
                    let url = linkEl?.href || titleEl?.href || '';
                    let title = titleEl?.textContent?.trim() || '';
                    let snippet = snippetEl?.textContent?.trim() || '';
                    
                    // Skip internal links
                    if (url && !url.includes('duckduckgo.com') && !url.includes('google.com') && title) {
                        results.push({ title, url, snippet });
                    }
                }
            }
            
            // Fallback: just grab all external links with reasonable titles
            if (results.length === 0) {
                const allLinks = document.querySelectorAll('a[href^="http"]');
                for (const link of allLinks) {
                    const url = link.href;
                    const title = link.textContent?.trim() || '';
                    if (url && title && title.length > 10 && title.length < 200 &&
                        !url.includes('duckduckgo') && !url.includes('google.com') &&
                        !url.includes('youtube.com/watch')) {
                        if (!results.find(r => r.url === url)) {
                            results.push({ title, url, snippet: '' });
                        }
                    }
                }
            }
            
            return JSON.stringify(results.slice(0, 10));
        })()
    "#;
    
    let result = page.evaluate(js_code)
        .await
        .map_err(|e| format!("JS evaluation error: {}", e))?;
    
    // Parse the results
    let results_str = result.into_value::<String>()
        .unwrap_or_else(|_| "[]".to_string());
    
    println!("[web::headless] Raw results: {}", &results_str[..results_str.len().min(500)]);
    
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&results_str)
        .unwrap_or_default();
    
    let results: Vec<SearchResult> = parsed.iter()
        .filter_map(|r| {
            let title = r.get("title")?.as_str()?.to_string();
            let url = r.get("url")?.as_str()?.to_string();
            let snippet = r.get("snippet").and_then(|s| s.as_str()).unwrap_or("").to_string();
            
            if !title.is_empty() && !url.is_empty() {
                Some(SearchResult { title, url, snippet })
            } else {
                None
            }
        })
        .take(max)
        .collect();
    
    // Clean up
    let _ = browser.close().await;
    handle.abort();
    
    println!("[web::headless] Found {} results", results.len());
    Ok(results)
}

async fn search_with_text_browser(query: &str, max: usize) -> Result<Vec<SearchResult>, String> {
    use std::process::Command;
    
    // Check if lynx is available
    let lynx_check = Command::new("which")
        .arg("lynx")
        .output();
    
    if lynx_check.is_err() || !lynx_check.unwrap().status.success() {
        println!("[web::text_browser] lynx not installed. Install with: brew install lynx");
        return Ok(Vec::new());
    }
    
    println!("[web::text_browser] Using lynx for: {}", query);
    
    // Use DuckDuckGo lite which serves simple HTML to text browsers
    let search_url = format!(
        "https://lite.duckduckgo.com/lite/?q={}",
        urlencoding::encode(query)
    );
    
    // Run lynx in dump mode - outputs plain text
    let output = Command::new("lynx")
        .args(&[
            "-dump",           // Output plain text
            "-nolist",         // Don't append link list at end
            "-width=200",      // Wide output to avoid wrapping
            "-accept_all_cookies",
            "-useragent=Lynx/2.8.9rel.1 libwww-FM/2.14",
            &search_url
        ])
        .output()
        .map_err(|e| format!("Failed to run lynx: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        println!("[web::text_browser] lynx failed: {}", stderr);
        return Ok(Vec::new());
    }
    
    let text = String::from_utf8_lossy(&output.stdout);
    println!("[web::text_browser] Got {} bytes of text output", text.len());
    
    // Parse the lynx output for search results
    // DDG lite format: "1.  Title\n    Description\n    www.domain.com"
    let mut results = Vec::new();
    let lines: Vec<&str> = text.lines().collect();
    
    // Look for numbered results pattern: "1.  Title"
    let numbered_pattern = regex::Regex::new(r"^\s*(\d+)\.\s+(.+)$").ok();
    // URL pattern - domain with optional path (no http prefix in DDG lite)
    let url_pattern = regex::Regex::new(r"^\s*((?:www\.)?[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:/[^\s]*)?)\s*$").ok();
    
    if let (Some(num_re), Some(url_re)) = (numbered_pattern, url_pattern) {
        let mut i = 0;
        while i < lines.len() && results.len() < max {
            let line = lines[i];
            
            // Check if this is a numbered result line
            if let Some(caps) = num_re.captures(line) {
                let title = caps.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
                
                if !title.is_empty() {
                    let mut snippet = String::new();
                    let mut url = String::new();
                    
                    // Look ahead for snippet and URL (within next 5 lines)
                    for j in (i + 1)..lines.len().min(i + 6) {
                        let next_line = lines[j].trim();
                        
                        // Check if it's a URL line
                        if let Some(url_caps) = url_re.captures(lines[j]) {
                            url = format!("https://{}", url_caps.get(1).map(|m| m.as_str()).unwrap_or(""));
                            break; // URL marks end of this result
                        } else if !next_line.is_empty() && next_line.len() > 10 {
                            // It's probably part of the snippet
                            if snippet.is_empty() {
                                snippet = next_line.to_string();
                            } else {
                                snippet.push(' ');
                                snippet.push_str(next_line);
                            }
                        }
                    }
                    
                    // Only add if we found a URL
                    if !url.is_empty() && !url.contains("duckduckgo.com") {
                        println!("[web::text_browser] Found: {} -> {}", title, url);
                        results.push(SearchResult {
                            title,
                            url,
                            snippet,
                        });
                    }
                }
            }
            i += 1;
        }
    }
    
    println!("[web::text_browser] Found {} results", results.len());
    Ok(results)
}

async fn search_bing(client: &Client, query: &str, max: usize) -> Result<Vec<SearchResult>, String> {
    let encoded_query = urlencoding::encode(query);
    let search_url = format!(
        "https://www.bing.com/search?q={}&count={}",
        encoded_query,
        max
    );
    
    println!("[web::bing] Searching: {}", search_url);
    
    let response = client
        .get(&search_url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.5")
        .header("Accept-Encoding", "gzip, deflate")
        .header("DNT", "1")
        .header("Connection", "keep-alive")
        .header("Upgrade-Insecure-Requests", "1")
        .send()
        .await
        .map_err(|e| format!("Bing request failed: {}", e))?;
    
    if !response.status().is_success() {
        println!("[web::bing] Failed with status: {}", response.status());
        return Err(format!("Bing failed with status: {}", response.status()));
    }
    
    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Bing response: {}", e))?;
    
    println!("[web::bing] Response length: {} bytes", html.len());
    
    let document = Html::parse_document(&html);
    let mut results = Vec::new();
    
    // Strategy 1: Bing organic results with .b_algo
    if let Ok(result_selector) = Selector::parse("li.b_algo") {
        let title_selector = Selector::parse("h2 a").ok();
        let snippet_selector = Selector::parse(".b_caption p, .b_algoSlug").ok();
        
        for result in document.select(&result_selector).take(max) {
            let (title, url) = title_selector.as_ref()
                .and_then(|sel| result.select(sel).next())
                .map(|el| {
                    let t = el.text().collect::<String>().trim().to_string();
                    let u = el.value().attr("href").unwrap_or_default().to_string();
                    (t, u)
                })
                .unwrap_or_default();
            
            let snippet = snippet_selector.as_ref()
                .and_then(|sel| result.select(sel).next())
                .map(|el| el.text().collect::<String>())
                .unwrap_or_default()
                .trim()
                .to_string();
            
            if !title.is_empty() && !url.is_empty() && url.starts_with("http") {
                results.push(SearchResult { title, url, snippet });
            }
        }
    }
    
    // Strategy 2: Try alternative Bing selectors
    if results.is_empty() {
        println!("[web::bing] Standard selectors failed, trying alternatives...");
        
        // Try finding any links with titles that look like search results
        if let Ok(link_selector) = Selector::parse("a[href^='http']") {
            for link in document.select(&link_selector) {
                let url = link.value().attr("href").unwrap_or_default().to_string();
                let title = link.text().collect::<String>().trim().to_string();
                
                // Filter: must be external, have meaningful title, not Bing/Microsoft internal
                if url.starts_with("http") 
                    && !url.contains("bing.com")
                    && !url.contains("microsoft.com")
                    && !url.contains("go.microsoft")
                    && !title.is_empty()
                    && title.len() > 10
                    && title.len() < 200
                    && !results.iter().any(|r: &SearchResult| r.url == url)
                {
                    results.push(SearchResult {
                        title,
                        url,
                        snippet: String::new(),
                    });
                    if results.len() >= max {
                        break;
                    }
                }
            }
        }
    }
    
    // Debug: print sample of HTML if no results
    if results.is_empty() {
        // Check if it's a captcha or error page
        let html_lower = html.to_lowercase();
        if html_lower.contains("captcha") || html_lower.contains("unusual traffic") {
            println!("[web::bing] BLOCKED: Captcha/bot detection triggered");
        } else if html_lower.contains("b_algo") {
            println!("[web::bing] HTML contains b_algo but selector failed");
        } else {
            println!("[web::bing] No b_algo found in HTML. Sample: {}...", 
                &html.chars().skip(1000).take(500).collect::<String>());
        }
    }
    
    println!("[web::bing] Found {} results", results.len());
    Ok(results)
}

async fn search_duckduckgo(client: &Client, query: &str, max: usize) -> Result<Vec<SearchResult>, String> {
    let encoded_query = urlencoding::encode(query);
    
    // Use the lite version which is more scraper-friendly
    let search_url = format!(
        "https://lite.duckduckgo.com/lite/?q={}",
        encoded_query
    );
    
    println!("[web::duckduckgo] Searching: {}", search_url);
    
    let response = client
        .get(&search_url)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.5")
        .header("DNT", "1")
        .header("Connection", "keep-alive")
        .header("Upgrade-Insecure-Requests", "1")
        .send()
        .await
        .map_err(|e| format!("DuckDuckGo request failed: {}", e))?;
    
    if !response.status().is_success() {
        println!("[web::duckduckgo] Failed with status: {}", response.status());
        return Err(format!("DuckDuckGo failed with status: {}", response.status()));
    }
    
    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read DuckDuckGo response: {}", e))?;
    
    // Debug: print first 500 chars of response
    println!("[web::duckduckgo] Response preview: {}...", &html.chars().take(500).collect::<String>());
    
    let document = Html::parse_document(&html);
    
    // Try multiple selector strategies
    let mut results = Vec::new();
    
    // Strategy 1: Lite version uses table rows
    if let Ok(row_selector) = Selector::parse("table tr") {
        if let Ok(link_selector) = Selector::parse("a.result-link") {
            for row in document.select(&row_selector).take(max * 2) {
                if let Some(link) = row.select(&link_selector).next() {
                    let title = link.text().collect::<String>().trim().to_string();
                    let url = link.value().attr("href").unwrap_or_default().to_string();
                    
                    if !title.is_empty() && !url.is_empty() && url.starts_with("http") {
                        results.push(SearchResult { 
                            title, 
                            url, 
                            snippet: String::new() 
                        });
                    }
                }
            }
        }
    }
    
    // Strategy 2: Try the standard result class selectors
    if results.is_empty() {
        if let Ok(result_selector) = Selector::parse(".result, .web-result, .results_links") {
            let title_selector = Selector::parse(".result__title a, .result__a, a.result-link").ok();
            let snippet_selector = Selector::parse(".result__snippet, .result__body").ok();
            
            for result in document.select(&result_selector).take(max) {
                let title = title_selector.as_ref()
                    .and_then(|sel| result.select(sel).next())
                    .map(|el| el.text().collect::<String>())
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                
                let url = title_selector.as_ref()
                    .and_then(|sel| result.select(sel).next())
                    .and_then(|el| el.value().attr("href"))
                    .map(|href| {
                        if href.contains("//duckduckgo.com/l/?uddg=") {
                            urlencoding::decode(href.split("uddg=").nth(1).unwrap_or(href))
                                .map(|s| s.split('&').next().unwrap_or(&s).to_string())
                                .unwrap_or_else(|_| href.to_string())
                        } else {
                            href.to_string()
                        }
                    })
                    .unwrap_or_default();
                
                let snippet = snippet_selector.as_ref()
                    .and_then(|sel| result.select(sel).next())
                    .map(|el| el.text().collect::<String>())
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                
                if !title.is_empty() && !url.is_empty() {
                    results.push(SearchResult { title, url, snippet });
                }
            }
        }
    }
    
    // Strategy 3: Find all links that look like results
    if results.is_empty() {
        if let Ok(link_selector) = Selector::parse("a[href^='http']") {
            for link in document.select(&link_selector).take(max * 3) {
                let url = link.value().attr("href").unwrap_or_default().to_string();
                let title = link.text().collect::<String>().trim().to_string();
                
                // Filter out DuckDuckGo internal links and empty titles
                if !url.contains("duckduckgo.com") 
                    && !url.contains("duck.co")
                    && !title.is_empty() 
                    && title.len() > 5 
                    && url.starts_with("http")
                {
                    if !results.iter().any(|r: &SearchResult| r.url == url) {
                        results.push(SearchResult { 
                            title, 
                            url, 
                            snippet: String::new() 
                        });
                    }
                }
            }
        }
    }
    
    // Limit results
    results.truncate(max);
    
    println!("[web::duckduckgo] Found {} results", results.len());
    Ok(results)
}

async fn search_google(client: &Client, query: &str, max: usize) -> Result<Vec<SearchResult>, String> {
    let encoded_query = urlencoding::encode(query);
    let search_url = format!(
        "https://www.google.com/search?q={}&num={}",
        encoded_query,
        max
    );
    
    println!("[web::google] Searching: {}", search_url);
    
    let response = client
        .get(&search_url)
        .send()
        .await
        .map_err(|e| format!("Google request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Google failed with status: {}", response.status()));
    }
    
    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Google response: {}", e))?;
    
    let document = Html::parse_document(&html);
    let mut results = Vec::new();
    
    // Google search results are in divs with class "g"
    let result_selector = Selector::parse("div.g").unwrap();
    let title_selector = Selector::parse("h3").unwrap();
    let link_selector = Selector::parse("a").unwrap();
    let snippet_selector = Selector::parse("div.VwiC3b, span.aCOpRe, div[data-sncf]").unwrap();
    
    for result in document.select(&result_selector).take(max) {
        let title = result
            .select(&title_selector)
            .next()
            .map(|el| el.text().collect::<String>())
            .unwrap_or_default()
            .trim()
            .to_string();
        
        let url = result
            .select(&link_selector)
            .next()
            .and_then(|el| el.value().attr("href"))
            .map(|href| {
                // Clean up Google redirect URLs
                if href.starts_with("/url?q=") {
                    href[7..].split('&').next().unwrap_or(href).to_string()
                } else if href.starts_with("http") {
                    href.to_string()
                } else {
                    String::new()
                }
            })
            .unwrap_or_default();
        
        let snippet = result
            .select(&snippet_selector)
            .next()
            .map(|el| el.text().collect::<String>())
            .unwrap_or_default()
            .trim()
            .to_string();
        
        if !title.is_empty() && !url.is_empty() && url.starts_with("http") {
            results.push(SearchResult { title, url, snippet });
        }
    }
    
    // If the "g" selector didn't work, try alternative selectors
    if results.is_empty() {
        println!("[web::google] Standard selectors failed, trying alternatives...");
        
        // Try to find any links with titles
        let link_selector = Selector::parse("a[href^='http']").unwrap();
        for link in document.select(&link_selector).take(max * 2) {
            let url = link.value().attr("href").unwrap_or_default().to_string();
            
            // Skip Google's own URLs
            if url.contains("google.com") || url.contains("gstatic.com") {
                continue;
            }
            
            let title = link.text().collect::<String>().trim().to_string();
            
            if !title.is_empty() && title.len() > 10 && !url.is_empty() {
                results.push(SearchResult { 
                    title, 
                    url, 
                    snippet: String::new() 
                });
                
                if results.len() >= max {
                    break;
                }
            }
        }
    }
    
    println!("[web::google] Found {} results", results.len());
    Ok(results)
}

#[command]
pub async fn fetch_url(url: String) -> Result<WebContent, String> {
    println!("[web::fetch_url] Fetching: {}", url);
    
    let parsed_url = url::Url::parse(&url)
        .map_err(|e| format!("Invalid URL: {}", e))?;
    
    if parsed_url.scheme() != "http" && parsed_url.scheme() != "https" {
        return Err("Only HTTP and HTTPS URLs are supported".to_string());
    }
    
    let client = create_client()?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch URL: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Request failed with status: {}", response.status()));
    }
    
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("text/html")
        .to_string();
    
    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;
    
    let document = Html::parse_document(&html);
    
    let title = document
        .select(&Selector::parse("title").unwrap())
        .next()
        .map(|el| el.text().collect::<String>())
        .unwrap_or_default()
        .trim()
        .to_string();
    
    let content = extract_text_content(&document);
    
    let truncated_content = if content.len() > MAX_CONTENT_LENGTH {
        format!("{}... [truncated]", &content[..MAX_CONTENT_LENGTH])
    } else {
        content
    };
    
    println!("[web::fetch_url] Extracted {} characters", truncated_content.len());
    
    Ok(WebContent {
        url,
        title,
        content: truncated_content,
        content_type,
    })
}

#[command]
pub async fn fetch_url_rendered(url: String) -> Result<WebContent, String> {
    println!("[web::fetch_url_rendered] Fetching with browser: {}", url);
    
    let parsed_url = url::Url::parse(&url)
        .map_err(|e| format!("Invalid URL: {}", e))?;
    
    if parsed_url.scheme() != "http" && parsed_url.scheme() != "https" {
        return Err("Only HTTP and HTTPS URLs are supported".to_string());
    }
    
    // Create a unique temp directory for this browser instance to allow parallel execution
    let unique_id = uuid::Uuid::new_v4().to_string();
    let user_data_dir = std::env::temp_dir().join(format!("chromiumoxide-{}", unique_id));
    println!("[web::fetch_url_rendered] Using unique browser profile: {:?}", user_data_dir);
    
    // Use headless browser to render JavaScript with unique data dir for parallel support
    let config = BrowserConfig::builder()
        .no_sandbox()
        .user_data_dir(&user_data_dir)
        .window_size(1920, 1080)
        .build()
        .map_err(|e| format!("Browser config error: {}", e))?;
    
    let (mut browser, mut handler) = Browser::launch(config)
        .await
        .map_err(|e| format!("Browser launch error: {}. {}", e, BROWSER_ERROR_MSG))?;
    
    let handle = tokio::spawn(async move {
        while let Some(_) = handler.next().await {}
    });
    
    let page = browser.new_page(&url)
        .await
        .map_err(|e| format!("Navigation error: {}", e))?;
    
    // Wait for page to load and JavaScript to execute
    tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
    
    // Get the page title
    let title_js = "document.title";
    let title = page.evaluate(title_js)
        .await
        .ok()
        .and_then(|r| r.into_value::<String>().ok())
        .unwrap_or_default();
    
    // Extract text content, focusing on tables for rankings
    let content_js = r#"
        (() => {
            let content = '';
            
            // Try to find ranking tables first
            const tables = document.querySelectorAll('table');
            for (const table of tables) {
                const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent?.trim() || '');
                const rows = table.querySelectorAll('tbody tr');
                
                if (rows.length > 0) {
                    // Format as markdown table
                    if (headers.length > 0) {
                        content += '| ' + headers.join(' | ') + ' |\n';
                        content += '|' + headers.map(() => '---').join('|') + '|\n';
                    }
                    
                    for (const row of rows) {
                        const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent?.trim() || '');
                        if (cells.length > 0) {
                            content += '| ' + cells.join(' | ') + ' |\n';
                        }
                    }
                    content += '\n';
                }
            }
            
            // If no tables, get main content
            if (!content) {
                const main = document.querySelector('main, article, .content, #content') || document.body;
                const paragraphs = main.querySelectorAll('p, h1, h2, h3, li');
                for (const p of paragraphs) {
                    const text = p.textContent?.trim();
                    if (text && text.length > 10) {
                        content += text + '\n\n';
                    }
                }
            }
            
            return content.slice(0, 10000);
        })()
    "#;
    
    let content = page.evaluate(content_js)
        .await
        .ok()
        .and_then(|r| r.into_value::<String>().ok())
        .unwrap_or_default();
    
    // Clean up browser
    let _ = browser.close().await;
    handle.abort();
    
    // Clean up temp directory (non-blocking, ignore errors)
    let cleanup_dir = user_data_dir.clone();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        let _ = std::fs::remove_dir_all(&cleanup_dir);
    });
    
    let truncated_content = if content.len() > MAX_CONTENT_LENGTH {
        format!("{}... [truncated]", &content[..MAX_CONTENT_LENGTH])
    } else {
        content
    };
    
    println!("[web::fetch_url_rendered] Extracted {} characters", truncated_content.len());
    
    Ok(WebContent {
        url,
        title,
        content: truncated_content,
        content_type: "text/html".to_string(),
    })
}

fn extract_text_content(document: &Html) -> String {
    let body_selector = Selector::parse("body").unwrap();
    let main_selector = Selector::parse("main, article, .content, #content, .post, .article").unwrap();
    let paragraph_selector = Selector::parse("p, h1, h2, h3, h4, h5, h6, li, td, th, pre, code, blockquote").unwrap();
    
    let body = match document.select(&body_selector).next() {
        Some(b) => b,
        None => return String::new(),
    };
    
    let main_content = document.select(&main_selector).next();
    let content_root = main_content.unwrap_or(body);
    
    let mut text_parts = Vec::new();
    
    for element in content_root.select(&paragraph_selector) {
        let mut should_skip = false;
        
        for ancestor in element.ancestors() {
            if let Some(el) = ancestor.value().as_element() {
                let tag = el.name();
                if tag == "script" || tag == "style" || tag == "nav" || tag == "footer" 
                   || tag == "header" || tag == "aside" {
                    should_skip = true;
                    break;
                }
                if let Some(class) = el.attr("class") {
                    let class_lower = class.to_lowercase();
                    if class_lower.contains("nav") || class_lower.contains("menu") 
                       || class_lower.contains("footer") || class_lower.contains("header") 
                       || class_lower.contains("sidebar") || class_lower.contains("ad") 
                       || class_lower.contains("cookie") || class_lower.contains("popup") {
                        should_skip = true;
                        break;
                    }
                }
            }
        }
        
        if should_skip {
            continue;
        }
        
        let text: String = element.text().collect::<Vec<_>>().join(" ");
        let cleaned = text.split_whitespace().collect::<Vec<_>>().join(" ");
        
        if !cleaned.is_empty() && cleaned.len() > 20 {
            text_parts.push(cleaned);
        }
    }
    
    text_parts.join("\n\n")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockQuote {
    pub symbol: String,
    pub name: String,
    pub price: f64,
    pub change: f64,
    pub change_percent: f64,
    pub volume: u64,
    pub market_cap: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketMovers {
    pub gainers: Vec<StockQuote>,
    pub losers: Vec<StockQuote>,
    pub most_active: Vec<StockQuote>,
}

// Helper to validate a stock quote result
fn validate_quote(result: Result<StockQuote, String>, symbol: &str, source: &str) -> Option<StockQuote> {
    match result {
        Ok(quote) if quote.price > 0.0 => {
            if quote.symbol.to_uppercase() == symbol.to_uppercase() {
                println!("[web::get_stock_quote] SUCCESS from {}: {} @ ${:.2} ({:+.2}%)", 
                    source, quote.symbol, quote.price, quote.change_percent);
                Some(quote)
            } else {
                println!("[web::get_stock_quote] {} SYMBOL MISMATCH: requested '{}', got '{}'", 
                    source, symbol, quote.symbol);
                None
            }
        }
        Ok(_) => {
            println!("[web::get_stock_quote] {} returned zero price", source);
            None
        }
        Err(e) => {
            println!("[web::get_stock_quote] {} failed: {}", source, e);
            None
        }
    }
}

// Try multiple sources for stock quotes IN PARALLEL
// First successful result wins, others are canceled
#[command]
pub async fn get_stock_quote(symbol: String) -> Result<StockQuote, String> {
    let client = create_client()?;
    let symbol_upper = symbol.to_uppercase().trim().to_string();
    
    println!("[web::get_stock_quote] ==============================================");
    println!("[web::get_stock_quote] Fetching quote for '{}' (PARALLEL)", symbol_upper);
    println!("[web::get_stock_quote] ==============================================");
    
    // Per-source timeout (5 seconds each)
    let source_timeout = Duration::from_secs(5);
    
    // Use a channel to receive results from parallel tasks
    let (tx, mut rx) = tokio::sync::mpsc::channel::<(String, Option<StockQuote>)>(4);
    
    // Spawn all sources in parallel
    let sources = vec![
        ("Yahoo Finance", "yahoo"),
        ("Google Finance", "google"),
        ("Stocktwits", "stocktwits"),
        ("MarketWatch", "marketwatch"),
    ];
    
    for (source_name, source_id) in sources {
        let client = client.clone();
        let symbol = symbol_upper.clone();
        let tx = tx.clone();
        let source_name = source_name.to_string();
        let source_id = source_id.to_string();
        
        tokio::spawn(async move {
            let result = match source_id.as_str() {
                "yahoo" => timeout(source_timeout, fetch_yahoo_finance_quote(&client, &symbol)).await,
                "google" => timeout(source_timeout, fetch_google_finance_quote(&client, &symbol)).await,
                "stocktwits" => timeout(source_timeout, fetch_stocktwits_quote(&client, &symbol)).await,
                "marketwatch" => timeout(source_timeout, fetch_marketwatch_quote(&client, &symbol)).await,
                _ => return,
            };
            
            let quote = match result {
                Ok(inner) => validate_quote(inner, &symbol, &source_name),
                Err(_) => {
                    println!("[web::get_stock_quote] {} timed out", source_name);
                    None
                }
            };
            
            let _ = tx.send((source_name, quote)).await;
        });
    }
    
    // Drop our sender so the channel closes when all tasks complete
    drop(tx);
    
    // Wait for first valid result
    let mut received = 0;
    while let Some((source, quote_opt)) = rx.recv().await {
        received += 1;
        if let Some(quote) = quote_opt {
            println!("[web::get_stock_quote] Using result from {} (received {} responses)", source, received);
            return Ok(quote);
        }
    }
    
    println!("[web::get_stock_quote] FAILED: All {} sources failed for '{}'", received, symbol_upper);
    Err(format!("Could not find stock quote for '{}'. Please verify the ticker symbol is correct.", symbol_upper))
}

async fn fetch_yahoo_finance_quote(client: &Client, symbol: &str) -> Result<StockQuote, String> {
    let symbol_upper = symbol.to_uppercase();
    
    // Yahoo Finance v8 API endpoint
    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?interval=1d&range=1d",
        symbol_upper
    );
    
    println!("[web::yahoo] Fetching from: {}", url);
    
    let response = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .send()
        .await
        .map_err(|e| format!("Yahoo request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Yahoo returned status: {}", response.status()));
    }
    
    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Yahoo JSON: {}", e))?;
    
    // Navigate the JSON structure
    let result = json
        .get("chart")
        .and_then(|c| c.get("result"))
        .and_then(|r| r.get(0))
        .ok_or("Invalid Yahoo response structure")?;
    
    let meta = result.get("meta").ok_or("No meta in response")?;
    
    let returned_symbol = meta
        .get("symbol")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_uppercase();
    
    // Verify symbol matches
    if !returned_symbol.is_empty() && returned_symbol != symbol_upper {
        return Err(format!("Symbol mismatch: expected {}, got {}", symbol_upper, returned_symbol));
    }
    
    let price = meta
        .get("regularMarketPrice")
        .and_then(|p| p.as_f64())
        .unwrap_or(0.0);
    
    let prev_close = meta
        .get("chartPreviousClose")
        .or_else(|| meta.get("previousClose"))
        .and_then(|p| p.as_f64())
        .unwrap_or(0.0);
    
    let name = meta
        .get("shortName")
        .or_else(|| meta.get("longName"))
        .and_then(|n| n.as_str())
        .unwrap_or(&symbol_upper)
        .to_string();
    
    let volume = meta
        .get("regularMarketVolume")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    
    // Calculate change from previous close
    let change = if prev_close > 0.0 { price - prev_close } else { 0.0 };
    let change_percent = if prev_close > 0.0 { (change / prev_close) * 100.0 } else { 0.0 };
    
    println!("[web::yahoo] Parsed: {} @ ${:.2}, prev_close=${:.2}, change=${:.4} ({:.4}%)", 
        symbol_upper, price, prev_close, change, change_percent);
    
    if price > 0.0 {
        Ok(StockQuote {
            symbol: symbol_upper,
            name,
            price,
            change,
            change_percent,
            volume,
            market_cap: None,
        })
    } else {
        Err("Could not parse Yahoo Finance data".to_string())
    }
}

async fn fetch_stocktwits_quote(client: &Client, symbol: &str) -> Result<StockQuote, String> {
    let symbol_upper = symbol.to_uppercase();
    let url = format!("https://stocktwits.com/symbol/{}", symbol_upper);
    println!("[web::stocktwits] Fetching quote from: {}", url);
    
    let response = client.get(&url).send().await
        .map_err(|e| format!("Stocktwits request failed: {}", e))?;
    
    // Check if we got redirected to a different symbol page
    let final_url = response.url().to_string().to_uppercase();
    if !final_url.ends_with(&format!("/{}", symbol_upper)) && 
       !final_url.ends_with(&format!("/{}#", symbol_upper)) &&
       !final_url.contains(&format!("/SYMBOL/{}", symbol_upper)) {
        println!("[web::stocktwits] URL redirected to different symbol: {} (expected {})", final_url, symbol_upper);
        return Err(format!("Symbol {} redirected to different page", symbol_upper));
    }
    
    if !response.status().is_success() {
        return Err(format!("Stocktwits returned status: {}", response.status()));
    }
    
    let html = response.text().await
        .map_err(|e| format!("Failed to read Stocktwits response: {}", e))?;
    
    // Strict verification: symbol must appear in exact format in the HTML
    // Check for exact symbol in various HTML patterns
    let html_upper = html.to_uppercase();
    let exact_symbol_patterns = [
        format!(">{}<", symbol_upper),
        format!("\"{}\"", symbol_upper),
        format!("/{}\">", symbol_upper),
        format!("/SYMBOL/{}", symbol_upper),
        format!("DATA-SYMBOL=\"{}\"", symbol_upper),
    ];
    
    let found_exact = exact_symbol_patterns.iter().any(|p| html_upper.contains(p));
    if !found_exact {
        println!("[web::stocktwits] Symbol {} not found in page content", symbol_upper);
        return Err(format!("Symbol {} not found on Stocktwits", symbol_upper));
    }
    
    // Also verify we don't have a different symbol that looks similar (e.g., HIMS vs HIMX)
    // Check if page title or header contains the exact symbol
    if let Ok(re) = regex::Regex::new(&format!(r#"(?i)<title>[^<]*\b{}\b"#, symbol_upper)) {
        if !re.is_match(&html) {
            // Title doesn't contain our symbol - might be wrong page
            // Try to extract what symbol the page is actually for
            if let Ok(title_re) = regex::Regex::new(r#"<title>\s*([A-Z]{1,5})\s*-"#) {
                if let Some(caps) = title_re.captures(&html.to_uppercase()) {
                    if let Some(m) = caps.get(1) {
                        let page_symbol = m.as_str();
                        if page_symbol != symbol_upper {
                            println!("[web::stocktwits] Page is for {} not {}", page_symbol, symbol_upper);
                            return Err(format!("Page is for {} not {}", page_symbol, symbol_upper));
                        }
                    }
                }
            }
        }
    }
    
    parse_stocktwits_html(&html, &symbol_upper)
}

fn parse_stocktwits_html(html: &str, symbol: &str) -> Result<StockQuote, String> {
    let mut price = 0.0;
    let mut prev_close = 0.0;
    let mut volume = 0u64;
    let mut name = symbol.to_string();
    
    // Parse price - look for "Price" label followed by value like "$11.02"
    if let Ok(re) = regex::Regex::new(r#"Price[^$]*\$(\d+\.?\d*)"#) {
        if let Some(caps) = re.captures(html) {
            if let Some(m) = caps.get(1) {
                if let Ok(p) = m.as_str().parse::<f64>() {
                    price = p;
                    println!("[web::stocktwits] Parsed price: ${:.2}", price);
                }
            }
        }
    }
    
    // Also try to find price in structured data format
    if price == 0.0 {
        if let Ok(re) = regex::Regex::new(r#"\$(\d+\.\d{2})"#) {
            for caps in re.captures_iter(html) {
                if let Some(m) = caps.get(1) {
                    if let Ok(p) = m.as_str().parse::<f64>() {
                        if p > 0.0 && p < 100000.0 {
                            price = p;
                            println!("[web::stocktwits] Parsed price (alt): ${:.2}", price);
                            break;
                        }
                    }
                }
            }
        }
    }
    
    // Parse previous close - look for "Prev Close" followed by value
    if let Ok(re) = regex::Regex::new(r#"Prev\s*Close[^$]*\$(\d+\.?\d*)"#) {
        if let Some(caps) = re.captures(html) {
            if let Some(m) = caps.get(1) {
                if let Ok(p) = m.as_str().parse::<f64>() {
                    prev_close = p;
                    println!("[web::stocktwits] Parsed prev close: ${:.2}", prev_close);
                }
            }
        }
    }
    
    // Parse volume - look for "Volume" followed by value like "2.29M"
    if let Ok(re) = regex::Regex::new(r#"(?i)Volume[^\d]*(\d+\.?\d*)\s*([KMB])?"#) {
        if let Some(caps) = re.captures(html) {
            if let Some(m) = caps.get(1) {
                if let Ok(v) = m.as_str().parse::<f64>() {
                    let multiplier = match caps.get(2).map(|m| m.as_str().to_uppercase()).as_deref() {
                        Some("K") => 1_000.0,
                        Some("M") => 1_000_000.0,
                        Some("B") => 1_000_000_000.0,
                        _ => 1.0,
                    };
                    volume = (v * multiplier) as u64;
                    println!("[web::stocktwits] Parsed volume: {}", volume);
                }
            }
        }
    }
    
    // Try to get company name from page
    if let Ok(re) = regex::Regex::new(&format!(r#"{}[^<]*([A-Za-z][A-Za-z\s,\.]+(?:Inc|Corp|Ltd|Co|LLC|LP)\.?)"#, symbol)) {
        if let Some(caps) = re.captures(html) {
            if let Some(m) = caps.get(1) {
                name = m.as_str().trim().to_string();
                println!("[web::stocktwits] Parsed name: {}", name);
            }
        }
    }
    
    // Also try title tag for name
    if name == symbol {
        if let Ok(re) = regex::Regex::new(r#"<title>([^:]+):"#) {
            if let Some(caps) = re.captures(html) {
                if let Some(m) = caps.get(1) {
                    let title_name = m.as_str().trim();
                    if !title_name.is_empty() && title_name != symbol {
                        name = title_name.to_string();
                    }
                }
            }
        }
    }
    
    // Calculate change from price and prev_close
    let change = if prev_close > 0.0 { price - prev_close } else { 0.0 };
    let change_percent = if prev_close > 0.0 { (change / prev_close) * 100.0 } else { 0.0 };
    
    println!("[web::stocktwits] Calculated change: ${:.2} ({:.2}%)", change, change_percent);
    
    if price > 0.0 {
        Ok(StockQuote {
            symbol: symbol.to_string(),
            name,
            price,
            change,
            change_percent,
            volume,
            market_cap: None,
        })
    } else {
        Err("Could not parse Stocktwits data".to_string())
    }
}

async fn fetch_google_finance_quote(client: &Client, symbol: &str) -> Result<StockQuote, String> {
    // Try different exchanges
    let exchanges = ["NASDAQ", "NYSE", "NYSEARCA", "AMEX"];
    let symbol_upper = symbol.to_uppercase();
    
    for exchange in &exchanges {
        let url = format!("https://www.google.com/finance/quote/{}:{}", symbol_upper, exchange);
        println!("[web::google] Trying URL: {}", url);
        
        if let Ok(response) = client.get(&url).send().await {
            // Check final URL to see if we got redirected to a different symbol
            let final_url = response.url().to_string().to_uppercase();
            
            if response.status().is_success() {
                // STRICT verification: final URL must contain our exact symbol followed by : or /
                // This prevents HIMX being confused with HIMS
                let expected_pattern = format!("/{}:", symbol_upper);
                let alt_pattern = format!("/{}/", symbol_upper);
                
                if !final_url.contains(&expected_pattern) && !final_url.contains(&alt_pattern) {
                    println!("[web::google] URL doesn't contain exact symbol pattern: {} (looking for '{}' or '{}')", 
                        final_url, expected_pattern, alt_pattern);
                    continue;
                }
                
                if let Ok(html) = response.text().await {
                    let html_upper = html.to_uppercase();
                    
                    // STRICT verification: HTML must contain the exact symbol:exchange combo
                    let exact_match = format!("{}:{}", symbol_upper, exchange.to_uppercase());
                    if !html_upper.contains(&exact_match) {
                        println!("[web::google] HTML doesn't contain exact match '{}'", exact_match);
                        
                        // Try to find what symbol the page is actually showing
                        if let Ok(re) = regex::Regex::new(r#"(?i)/FINANCE/QUOTE/([A-Z0-9]+):"#) {
                            if let Some(caps) = re.captures(&html) {
                                if let Some(m) = caps.get(1) {
                                    let actual_symbol = m.as_str().to_uppercase();
                                    if actual_symbol != symbol_upper {
                                        println!("[web::google] Page is actually for symbol '{}', not '{}'", actual_symbol, symbol_upper);
                                        continue;
                                    }
                                }
                            }
                        }
                        continue;
                    }
                    
                    if let Ok(quote) = parse_google_finance_html(&html, &symbol_upper) {
                        if quote.price > 0.0 {
                            println!("[web::google] Got quote for {} from {}: ${:.2} ({:+.2}%)", 
                                symbol_upper, exchange, quote.price, quote.change_percent);
                            return Ok(quote);
                        }
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    
    println!("[web::google] Symbol {} not found on any exchange", symbol_upper);
    Err(format!("Symbol '{}' not found. Please verify the ticker symbol is correct.", symbol_upper))
}

fn parse_google_finance_html(html: &str, symbol: &str) -> Result<StockQuote, String> {
    let document = Html::parse_document(html);
    
    println!("[web::google] Parsing HTML for symbol: {}", symbol);
    
    // Method 1: Try data attributes first (most reliable)
    let price_selector = Selector::parse("[data-last-price]").unwrap();
    let mut price = document.select(&price_selector)
        .next()
        .and_then(|el| el.value().attr("data-last-price"))
        .and_then(|p| p.parse::<f64>().ok())
        .unwrap_or(0.0);
    
    let change_selector = Selector::parse("[data-price-change]").unwrap();
    let mut change = document.select(&change_selector)
        .next()
        .and_then(|el| el.value().attr("data-price-change"))
        .and_then(|c| c.parse::<f64>().ok())
        .unwrap_or(0.0);
    
    let change_percent_selector = Selector::parse("[data-price-change-percent]").unwrap();
    let mut change_percent = document.select(&change_percent_selector)
        .next()
        .and_then(|el| el.value().attr("data-price-change-percent"))
        .and_then(|c| c.parse::<f64>().ok())
        .unwrap_or(0.0);
    
    println!("[web::google] Data attributes - price: {}, change: {}, change_pct: {}", price, change, change_percent);
    
    // Method 2: Parse from page content using regex
    if price == 0.0 {
        // Look for the main price which appears prominently
        let price_patterns = [
            r#">\$(\d{1,6}(?:,\d{3})*\.\d{2})<"#,
            r#"\$(\d{1,6}(?:,\d{3})*\.\d{2})"#,
            r#""regularMarketPrice":\{"raw":(\d+\.?\d*)"#,
            r#""price":\s*"?(\d+\.?\d*)"#,
        ];
        
        for pattern in price_patterns {
            if let Ok(re) = regex::Regex::new(pattern) {
                if let Some(caps) = re.captures(html) {
                    if let Some(m) = caps.get(1) {
                        let price_str = m.as_str().replace(",", "");
                        if let Ok(p) = price_str.parse::<f64>() {
                            if p > 0.0 && p < 1000000.0 {
                                price = p;
                                println!("[web::google] Parsed price via regex: ${:.2}", price);
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Method 3: Extract change info - MUST be careful to get TODAY's change, not 52-week or other metrics
    // Google Finance page has many percentages - we need the one for daily change
    if price > 0.0 && (change_percent == 0.0 || change == 0.0) {
        // Priority 1: Look for JSON data with regularMarketChange (most reliable)
        let json_patterns = [
            // regularMarketChange in JSON - this is the actual dollar change
            r#""regularMarketChange":\{"raw":([+-]?\d+\.?\d*)"#,
            // regularMarketChangePercent in JSON  
            r#""regularMarketChangePercent":\{"raw":([+-]?\d+\.?\d*)"#,
        ];
        
        let mut found_change = 0.0;
        let mut found_pct = 0.0;
        
        for (i, pattern) in json_patterns.iter().enumerate() {
            if let Ok(re) = regex::Regex::new(pattern) {
                if let Some(caps) = re.captures(html) {
                    if let Some(m) = caps.get(1) {
                        if let Ok(val) = m.as_str().parse::<f64>() {
                            if i == 0 {
                                found_change = val;
                                println!("[web::google] Found regularMarketChange: {:.4}", val);
                            } else {
                                found_pct = val;
                                println!("[web::google] Found regularMarketChangePercent: {:.4}", val);
                            }
                        }
                    }
                }
            }
        }
        
        if found_change != 0.0 {
            change = found_change;
            if found_pct != 0.0 {
                change_percent = found_pct;
            } else {
                change_percent = (change / price) * 100.0;
            }
        } else if found_pct != 0.0 {
            change_percent = found_pct;
            change = price * change_percent / 100.0;
        }
        
        // Priority 2: Look for specific pattern "Today" or "1 day" change which appears near daily change
        // Format: (+$0.77) (+6.37%) or (-$0.77) (-6.37%) followed by "today" or "1D"
        if change == 0.0 {
            // Pattern: "(+$X.XX)" or "(-$X.XX)" - dollar change in parentheses
            if let Ok(re) = regex::Regex::new(r#"\(([+-])\$(\d+\.?\d*)\)"#) {
                for caps in re.captures_iter(html) {
                    let sign = caps.get(1).map(|m| m.as_str()).unwrap_or("+");
                    let value = caps.get(2).and_then(|m| m.as_str().parse::<f64>().ok()).unwrap_or(0.0);
                    // Daily change should be a reasonable fraction of price (< 30%)
                    if value > 0.0 && value < price * 0.3 {
                        change = if sign == "-" { -value } else { value };
                        println!("[web::google] Found dollar change pattern: ${:+.4}", change);
                        break;
                    }
                }
            }
            
            // Pattern: "(+X.XX%)" or "(-X.XX%)" - percent change in parentheses
            if let Ok(re) = regex::Regex::new(r#"\(([+-])(\d{1,2}\.?\d*)%\)"#) {
                for caps in re.captures_iter(html) {
                    let sign = caps.get(1).map(|m| m.as_str()).unwrap_or("+");
                    let value = caps.get(2).and_then(|m| m.as_str().parse::<f64>().ok()).unwrap_or(0.0);
                    // Daily change percent should be reasonable (< 30%)
                    if value > 0.0 && value < 30.0 {
                        let pct = if sign == "-" { -value } else { value };
                        if change_percent == 0.0 {
                            change_percent = pct;
                            println!("[web::google] Found percent change pattern: {:+.4}%", pct);
                        }
                        break;
                    }
                }
            }
            
            // Calculate missing value from the one we found
            if change != 0.0 && change_percent == 0.0 {
                change_percent = (change / price) * 100.0;
            } else if change_percent != 0.0 && change == 0.0 {
                change = price * change_percent / 100.0;
            }
        }
        
        if change != 0.0 || change_percent != 0.0 {
            println!("[web::google] Final change values: ${:+.4} ({:+.4}%)", change, change_percent);
        }
    }
    
    // Get company name from title or page content
    let title_selector = Selector::parse("title").unwrap();
    let name = document.select(&title_selector)
        .next()
        .map(|el| el.text().collect::<String>())
        .map(|t| {
            t.split(" Stock Price")
                .next()
                .or_else(|| t.split(" - Google").next())
                .or_else(|| t.split('(').next())
                .unwrap_or(symbol)
                .trim()
                .to_string()
        })
        .unwrap_or_else(|| symbol.to_string());
    
    if price > 0.0 {
        Ok(StockQuote {
            symbol: symbol.to_string(),
            name,
            price,
            change,
            change_percent,
            volume: 0,
            market_cap: None,
        })
    } else {
        Err("Could not parse Google Finance data".to_string())
    }
}

async fn fetch_marketwatch_quote(client: &Client, symbol: &str) -> Result<StockQuote, String> {
    let symbol_upper = symbol.to_uppercase();
    let symbol_lower = symbol.to_lowercase();
    let url = format!("https://www.marketwatch.com/investing/stock/{}", symbol_lower);
    
    println!("[web::marketwatch] Fetching quote for {} from {}", symbol_upper, url);
    
    let response = client.get(&url).send().await
        .map_err(|e| format!("MarketWatch request failed: {}", e))?;
    
    // Check if we got redirected to a different symbol
    let final_url = response.url().to_string().to_lowercase();
    if !final_url.contains(&format!("/stock/{}", symbol_lower)) {
        println!("[web::marketwatch] URL redirected to different stock: {}", final_url);
        return Err(format!("MarketWatch redirected {} to different symbol", symbol_upper));
    }
    
    if !response.status().is_success() {
        return Err(format!("MarketWatch returned status: {}", response.status()));
    }
    
    let html = response.text().await
        .map_err(|e| format!("Failed to read MarketWatch response: {}", e))?;
    
    // Verify the page is for our exact symbol
    let html_upper = html.to_uppercase();
    if !html_upper.contains(&format!(">{}<", symbol_upper)) &&
       !html_upper.contains(&format!("\"SYMBOL\":\"{}\"", symbol_upper)) &&
       !html_upper.contains(&format!("/STOCK/{}", symbol_upper)) {
        println!("[web::marketwatch] Page doesn't contain exact symbol {}", symbol_upper);
        return Err(format!("MarketWatch page is not for symbol {}", symbol_upper));
    }
    
    let document = Html::parse_document(&html);
    
    // Try multiple selectors for price
    let price_selectors = [
        ".intraday__price .value",
        ".intraday__price bg-quote",
        "[data-field='Last']",
        ".quote__price bg-quote",
    ];
    
    let mut price = 0.0;
    for selector_str in price_selectors {
        if let Ok(selector) = Selector::parse(selector_str) {
            if let Some(el) = document.select(&selector).next() {
                let text = el.text().collect::<String>();
                let cleaned = text.trim().replace("$", "").replace(",", "");
                if let Ok(p) = cleaned.parse::<f64>() {
                    if p > 0.0 {
                        price = p;
                        break;
                    }
                }
            }
        }
    }
    
    // Try regex as fallback for price
    if price == 0.0 {
        if let Ok(re) = regex::Regex::new(r#"\$(\d{1,4}(?:,\d{3})*\.?\d*)"#) {
            if let Some(caps) = re.captures(&html) {
                if let Some(m) = caps.get(1) {
                    let cleaned = m.as_str().replace(",", "");
                    if let Ok(p) = cleaned.parse::<f64>() {
                        price = p;
                    }
                }
            }
        }
    }
    
    // Try multiple selectors for change
    let change_selectors = [
        ".intraday__change .change--point--q",
        "[data-field='Change']",
    ];
    
    let mut change = 0.0;
    for selector_str in change_selectors {
        if let Ok(selector) = Selector::parse(selector_str) {
            if let Some(el) = document.select(&selector).next() {
                let text = el.text().collect::<String>();
                let cleaned = text.trim().replace("$", "").replace(",", "");
                if let Ok(c) = cleaned.parse::<f64>() {
                    change = c;
                    break;
                }
            }
        }
    }
    
    // Try multiple selectors for percent change
    let pct_selectors = [
        ".intraday__change .change--percent--q",
        "[data-field='PercentChange']",
    ];
    
    let mut change_percent = 0.0;
    for selector_str in pct_selectors {
        if let Ok(selector) = Selector::parse(selector_str) {
            if let Some(el) = document.select(&selector).next() {
                let text = el.text().collect::<String>();
                let cleaned = text.trim().replace("%", "").replace(",", "");
                if let Ok(p) = cleaned.parse::<f64>() {
                    change_percent = p;
                    break;
                }
            }
        }
    }
    
    // Get company name
    let name_selectors = [".company__name", "h1.company__name", ".quote__title"];
    let mut name = symbol.to_string();
    for selector_str in name_selectors {
        if let Ok(selector) = Selector::parse(selector_str) {
            if let Some(el) = document.select(&selector).next() {
                let text = el.text().collect::<String>().trim().to_string();
                if !text.is_empty() {
                    name = text;
                    break;
                }
            }
        }
    }
    
    if price > 0.0 {
        println!("[web::marketwatch] Got quote for {}: ${:.2} ({:+.2}%)", symbol, price, change_percent);
        Ok(StockQuote {
            symbol: symbol.to_string(),
            name,
            price,
            change,
            change_percent,
            volume: 0,
            market_cap: None,
        })
    } else {
        println!("[web::marketwatch] Failed to parse quote for {}", symbol);
        Err(format!("Could not parse MarketWatch data for {}", symbol))
    }
}

// Get market movers from Stocktwits (trending) + MarketWatch (gainers/losers)
// Then enrich with actual prices from Google Finance
#[command]
pub async fn get_market_movers() -> Result<MarketMovers, String> {
    let client = create_client()?;
    
    println!("[web::get_market_movers] Fetching market movers");
    
    // Try MarketWatch for gainers/losers first (has actual prices)
    let mut gainers = Vec::new();
    let mut losers = Vec::new();
    let mut most_active = Vec::new();
    
    // Get gainers from MarketWatch
    println!("[web::get_market_movers] Fetching gainers from MarketWatch...");
    if let Ok(mw_gainers) = fetch_marketwatch_movers(&client, "gainers").await {
        gainers = mw_gainers;
        println!("[web::get_market_movers] Got {} gainers from MarketWatch", gainers.len());
    }
    
    tokio::time::sleep(Duration::from_millis(300)).await;
    
    // Get losers from MarketWatch
    println!("[web::get_market_movers] Fetching losers from MarketWatch...");
    if let Ok(mw_losers) = fetch_marketwatch_movers(&client, "losers").await {
        losers = mw_losers;
        println!("[web::get_market_movers] Got {} losers from MarketWatch", losers.len());
    }
    
    tokio::time::sleep(Duration::from_millis(300)).await;
    
    // Get most active from MarketWatch
    println!("[web::get_market_movers] Fetching most active from MarketWatch...");
    if let Ok(mw_active) = fetch_marketwatch_movers(&client, "actives").await {
        most_active = mw_active;
        println!("[web::get_market_movers] Got {} most active from MarketWatch", most_active.len());
    }
    
    // If MarketWatch failed, try Stocktwits for trending + fetch prices
    if gainers.is_empty() && losers.is_empty() && most_active.is_empty() {
        println!("[web::get_market_movers] MarketWatch failed, trying Stocktwits...");
        if let Ok(symbols) = fetch_stocktwits_symbols(&client).await {
            // Fetch actual prices for each trending symbol
            for symbol in symbols.iter().take(10) {
                if let Ok(quote) = fetch_quote_from_google(&client, symbol).await {
                    most_active.push(quote.clone());
                    if quote.change_percent > 0.0 {
                        gainers.push(quote);
                    } else if quote.change_percent < 0.0 {
                        losers.push(quote);
                    }
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }
    
    // Enrich ALL stocks with accurate quotes using multi-source approach
    // The scraped percentage data from MarketWatch is often wrong
    async fn enrich_stocks(stocks: &mut Vec<StockQuote>) {
        for stock in stocks.iter_mut() {
            // Always fetch fresh quote data - scraped percentages are unreliable
            println!("[web::enrich] Fetching accurate quote for {} from multiple sources", stock.symbol);
            // Use the main get_stock_quote which tries Yahoo, Google, StockTwits, MarketWatch in parallel
            if let Ok(quote) = get_stock_quote(stock.symbol.clone()).await {
                println!("[web::enrich] Got accurate quote for {}: ${:.2} ({:+.2}%)", 
                    stock.symbol, quote.price, quote.change_percent);
                stock.price = quote.price;
                stock.change = quote.change;
                stock.change_percent = quote.change_percent;
                if !quote.name.is_empty() {
                    stock.name = quote.name;
                }
            } else {
                println!("[web::enrich] Failed to get quote for {}", stock.symbol);
            }
            // Small delay to avoid overwhelming sources
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }
    
    // Enrich ALL stocks with accurate data from multiple sources
    println!("[web::get_market_movers] Enriching stocks with accurate quotes...");
    enrich_stocks(&mut gainers).await;
    enrich_stocks(&mut losers).await;
    enrich_stocks(&mut most_active).await;
    
    // Remove any stocks that still have no valid price
    gainers.retain(|s| s.price > 0.0);
    losers.retain(|s| s.price > 0.0);
    most_active.retain(|s| s.price > 0.0);
    
    // Sort by change percent
    gainers.sort_by(|a, b| b.change_percent.partial_cmp(&a.change_percent).unwrap_or(std::cmp::Ordering::Equal));
    losers.sort_by(|a, b| a.change_percent.partial_cmp(&b.change_percent).unwrap_or(std::cmp::Ordering::Equal));
    
    // Limit to top 5 each
    gainers.truncate(5);
    losers.truncate(5);
    most_active.truncate(10);
    
    println!("[web::get_market_movers] Final: {} gainers, {} losers, {} most active", 
        gainers.len(), losers.len(), most_active.len());
    
    if gainers.is_empty() && losers.is_empty() && most_active.is_empty() {
        return Err("Unable to fetch market data. Please try again later.".to_string());
    }
    
    Ok(MarketMovers {
        gainers,
        losers,
        most_active,
    })
}

async fn fetch_marketwatch_movers(client: &Client, category: &str) -> Result<Vec<StockQuote>, String> {
    // Use MarketWatch's market data pages which are more static
    let url = match category {
        "gainers" => "https://www.marketwatch.com/market-data/us?mod=market-data-center",
        "losers" => "https://www.marketwatch.com/market-data/us?mod=market-data-center",
        "actives" => "https://www.marketwatch.com/market-data/us?mod=market-data-center",
        _ => return Err("Invalid category".to_string()),
    };
    
    println!("[web::marketwatch] Fetching {} from MarketWatch...", category);
    
    let response = client.get(url).send().await
        .map_err(|e| format!("MarketWatch request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("MarketWatch returned status: {}", response.status()));
    }
    
    let html = response.text().await
        .map_err(|e| format!("Failed to read MarketWatch response: {}", e))?;
    
    let document = Html::parse_document(&html);
    let mut stocks = Vec::new();
    
    // MarketWatch market-data page has sections for gainers/losers/actives
    // Look for the relevant section based on category
    let section_title = match category {
        "gainers" => "Gainers",
        "losers" => "Losers", 
        "actives" => "Most Active",
        _ => "Gainers",
    };
    
    // Try to find tables with market data
    let table_selector = Selector::parse("table.table--primary tbody tr").unwrap();
    let symbol_selector = Selector::parse("td.table__cell a.link").unwrap();
    let change_selector = Selector::parse("td.table__cell--percent li").unwrap();
    
    // Parse each table looking for our data
    for row in document.select(&table_selector).take(20) {
        // Get symbol from link
        if let Some(symbol_el) = row.select(&symbol_selector).next() {
            let symbol = symbol_el.text().collect::<String>().trim().to_string();
            
            // Get all cells
            let cells: Vec<_> = row.select(&Selector::parse("td").unwrap()).collect();
            
            if cells.len() >= 3 && !symbol.is_empty() {
                // Try to extract price and change from cells
                let price_text = cells.get(1)
                    .map(|c| c.text().collect::<String>())
                    .unwrap_or_default()
                    .trim()
                    .replace("$", "")
                    .replace(",", "");
                    
                let change_pct_text = cells.iter()
                    .find(|c| c.text().collect::<String>().contains('%'))
                    .map(|c| c.text().collect::<String>())
                    .unwrap_or_default()
                    .trim()
                    .replace("%", "")
                    .replace("+", "");
                
                let price = price_text.parse::<f64>().unwrap_or(0.0);
                let change_percent = change_pct_text.parse::<f64>().unwrap_or(0.0);
                let change = price * change_percent / 100.0;
                
                if price > 0.0 || change_percent.abs() > 0.0 {
                    stocks.push(StockQuote {
                        symbol: symbol.clone(),
                        name: symbol,
                        price,
                        change,
                        change_percent,
                        volume: 0,
                        market_cap: None,
                    });
                }
            }
        }
    }
    
    // Filter by category if we found any stocks
    if !stocks.is_empty() {
        match category {
            "gainers" => {
                stocks.retain(|s| s.change_percent > 0.0);
                stocks.sort_by(|a, b| b.change_percent.partial_cmp(&a.change_percent).unwrap_or(std::cmp::Ordering::Equal));
            },
            "losers" => {
                stocks.retain(|s| s.change_percent < 0.0);
                stocks.sort_by(|a, b| a.change_percent.partial_cmp(&b.change_percent).unwrap_or(std::cmp::Ordering::Equal));
            },
            _ => {}
        }
        stocks.truncate(10);
    }
    
    println!("[web::marketwatch] Found {} {} stocks", stocks.len(), category);
    Ok(stocks)
}

async fn fetch_stocktwits_symbols(client: &Client) -> Result<Vec<String>, String> {
    let url = "https://api.stocktwits.com/api/2/trending/symbols.json";
    
    let response = client.get(url).send().await
        .map_err(|e| format!("Stocktwits request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Stocktwits returned status: {}", response.status()));
    }
    
    let json: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse Stocktwits response: {}", e))?;
    
    let mut symbols = Vec::new();
    
    if let Some(syms) = json.get("symbols").and_then(|s| s.as_array()) {
        for sym in syms {
            if let Some(symbol) = sym.get("symbol").and_then(|s| s.as_str()) {
                // Skip crypto symbols (they have . in them like BTC.X)
                if !symbol.contains('.') {
                    symbols.push(symbol.to_string());
                }
            }
        }
    }
    
    println!("[web::stocktwits] Found {} trending symbols", symbols.len());
    Ok(symbols)
}

async fn fetch_quote_from_google(client: &Client, symbol: &str) -> Result<StockQuote, String> {
    // Try Google Finance first
    if let Ok(quote) = fetch_google_finance_quote(client, symbol).await {
        if quote.price > 0.0 {
            return Ok(quote);
        }
    }
    
    // Fallback to MarketWatch
    println!("[web::fetch_quote] Google failed for {}, trying MarketWatch...", symbol);
    fetch_marketwatch_quote(client, symbol).await
}


fn format_market_cap(cap: f64) -> String {
    if cap >= 1_000_000_000_000.0 {
        format!("{:.2}T", cap / 1_000_000_000_000.0)
    } else if cap >= 1_000_000_000.0 {
        format!("{:.2}B", cap / 1_000_000_000.0)
    } else if cap >= 1_000_000.0 {
        format!("{:.2}M", cap / 1_000_000.0)
    } else {
        format!("{:.0}", cap)
    }
}
