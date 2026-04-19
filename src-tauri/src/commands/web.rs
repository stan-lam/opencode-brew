use reqwest::Client;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use tauri::command;
use std::time::Duration;

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

fn create_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

#[command]
pub async fn search_web(query: String, max_results: Option<u32>) -> Result<Vec<SearchResult>, String> {
    let max = max_results.unwrap_or(5).min(10) as usize;
    let client = create_client()?;
    
    let encoded_query = urlencoding::encode(&query);
    let search_url = format!(
        "https://html.duckduckgo.com/html/?q={}",
        encoded_query
    );
    
    println!("[web::search_web] Searching for: {}", query);
    
    let response = client
        .get(&search_url)
        .send()
        .await
        .map_err(|e| format!("Search request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Search failed with status: {}", response.status()));
    }
    
    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read search response: {}", e))?;
    
    let document = Html::parse_document(&html);
    let result_selector = Selector::parse(".result").unwrap();
    let title_selector = Selector::parse(".result__title a").unwrap();
    let snippet_selector = Selector::parse(".result__snippet").unwrap();
    
    let mut results = Vec::new();
    
    for result in document.select(&result_selector).take(max) {
        let title = result
            .select(&title_selector)
            .next()
            .map(|el| el.text().collect::<String>())
            .unwrap_or_default()
            .trim()
            .to_string();
        
        let url = result
            .select(&title_selector)
            .next()
            .and_then(|el| el.value().attr("href"))
            .map(|href| {
                if href.starts_with("//duckduckgo.com/l/?uddg=") {
                    urlencoding::decode(&href[25..])
                        .map(|s| s.split('&').next().unwrap_or(&s).to_string())
                        .unwrap_or_else(|_| href.to_string())
                } else {
                    href.to_string()
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
        
        if !title.is_empty() && !url.is_empty() {
            results.push(SearchResult { title, url, snippet });
        }
    }
    
    println!("[web::search_web] Found {} results", results.len());
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

// Try multiple sources for stock quotes
#[command]
pub async fn get_stock_quote(symbol: String) -> Result<StockQuote, String> {
    let client = create_client()?;
    let symbol_upper = symbol.to_uppercase().trim().to_string();
    
    println!("[web::get_stock_quote] ==============================================");
    println!("[web::get_stock_quote] Fetching quote for: '{}'", symbol_upper);
    println!("[web::get_stock_quote] ==============================================");
    
    // Try Google Finance FIRST (most reliable for exact symbol matching)
    println!("[web::get_stock_quote] Trying Google Finance...");
    match fetch_google_finance_quote(&client, &symbol_upper).await {
        Ok(quote) if quote.price > 0.0 => {
            // Final verification: returned symbol must match requested
            if quote.symbol.to_uppercase() == symbol_upper {
                println!("[web::get_stock_quote] SUCCESS from Google Finance: {} @ ${:.2}", quote.symbol, quote.price);
                return Ok(quote);
            } else {
                println!("[web::get_stock_quote] SYMBOL MISMATCH: requested '{}', got '{}'", symbol_upper, quote.symbol);
            }
        }
        Ok(_) => println!("[web::get_stock_quote] Google Finance returned zero price"),
        Err(e) => println!("[web::get_stock_quote] Google Finance failed: {}", e),
    }
    
    // Try Stocktwits as secondary
    println!("[web::get_stock_quote] Trying Stocktwits...");
    match fetch_stocktwits_quote(&client, &symbol_upper).await {
        Ok(quote) if quote.price > 0.0 => {
            if quote.symbol.to_uppercase() == symbol_upper {
                println!("[web::get_stock_quote] SUCCESS from Stocktwits: {} @ ${:.2}", quote.symbol, quote.price);
                return Ok(quote);
            } else {
                println!("[web::get_stock_quote] SYMBOL MISMATCH: requested '{}', got '{}'", symbol_upper, quote.symbol);
            }
        }
        Ok(_) => println!("[web::get_stock_quote] Stocktwits returned zero price"),
        Err(e) => println!("[web::get_stock_quote] Stocktwits failed: {}", e),
    }
    
    // Fallback to MarketWatch
    println!("[web::get_stock_quote] Trying MarketWatch...");
    match fetch_marketwatch_quote(&client, &symbol_upper).await {
        Ok(quote) if quote.price > 0.0 => {
            if quote.symbol.to_uppercase() == symbol_upper {
                println!("[web::get_stock_quote] SUCCESS from MarketWatch: {} @ ${:.2}", quote.symbol, quote.price);
                return Ok(quote);
            } else {
                println!("[web::get_stock_quote] SYMBOL MISMATCH: requested '{}', got '{}'", symbol_upper, quote.symbol);
            }
        }
        Ok(_) => println!("[web::get_stock_quote] MarketWatch returned zero price"),
        Err(e) => println!("[web::get_stock_quote] MarketWatch failed: {}", e),
    }
    
    println!("[web::get_stock_quote] FAILED: Could not get quote for '{}'", symbol_upper);
    Err(format!("Could not find stock quote for '{}'. Please verify the ticker symbol is correct.", symbol_upper))
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
    
    // Method 3: Extract change info from patterns in the HTML
    // Google Finance shows: $29.37 [arrow] +2.45% (+$0.70) Today
    if price > 0.0 && (change_percent == 0.0 || change == 0.0) {
        // Look for patterns with sign, percentage, and dollar change
        let change_patterns = [
            // Format: +2.45% or -1.26% (change percent with sign)
            r#"([+-])(\d{1,2}\.\d{1,2})%"#,
            // Format: regularMarketChangePercent in JSON
            r#""regularMarketChangePercent":\{"raw":([+-]?\d+\.?\d*)"#,
            // Format from data in script tags
            r#"changePercent["\s:]+([+-]?\d+\.?\d*)"#,
        ];
        
        for pattern in change_patterns {
            if let Ok(re) = regex::Regex::new(pattern) {
                for caps in re.captures_iter(html) {
                    let pct = if caps.len() == 3 {
                        // Pattern with separate sign
                        let sign = caps.get(1).map(|m| m.as_str()).unwrap_or("+");
                        let value = caps.get(2).and_then(|m| m.as_str().parse::<f64>().ok()).unwrap_or(0.0);
                        if sign == "-" { -value } else { value }
                    } else if caps.len() == 2 {
                        // Pattern with embedded sign
                        caps.get(1).and_then(|m| m.as_str().parse::<f64>().ok()).unwrap_or(0.0)
                    } else {
                        0.0
                    };
                    
                    // Valid change percent should be reasonable (< 50%)
                    if pct.abs() > 0.001 && pct.abs() < 50.0 {
                        change_percent = pct;
                        change = price * change_percent / 100.0;
                        println!("[web::google] Parsed change: {:+.2}% (${:+.2})", change_percent, change);
                        break;
                    }
                }
                if change_percent != 0.0 {
                    break;
                }
            }
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
    
    // Enrich stocks with missing prices from Google Finance
    async fn enrich_with_google(client: &Client, stocks: &mut Vec<StockQuote>) {
        for stock in stocks.iter_mut() {
            // If price or change percent is 0, fetch from Google Finance
            if stock.price == 0.0 || (stock.change_percent == 0.0 && stock.change == 0.0) {
                println!("[web::enrich] Fetching real price for {} from Google Finance", stock.symbol);
                if let Ok(quote) = fetch_google_finance_quote(client, &stock.symbol).await {
                    stock.price = quote.price;
                    stock.change = quote.change;
                    stock.change_percent = quote.change_percent;
                    stock.name = quote.name;
                }
                tokio::time::sleep(Duration::from_millis(150)).await;
            }
        }
    }
    
    // Enrich any stocks with missing data
    println!("[web::get_market_movers] Enriching stocks with Google Finance prices...");
    enrich_with_google(&client, &mut gainers).await;
    enrich_with_google(&client, &mut losers).await;
    enrich_with_google(&client, &mut most_active).await;
    
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
