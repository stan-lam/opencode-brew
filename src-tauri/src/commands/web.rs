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

// Try Google Finance first, then MarketWatch as fallback
#[command]
pub async fn get_stock_quote(symbol: String) -> Result<StockQuote, String> {
    let client = create_client()?;
    let symbol_upper = symbol.to_uppercase();
    
    println!("[web::get_stock_quote] Fetching quote for: {}", symbol_upper);
    
    // Try Google Finance first
    if let Ok(quote) = fetch_google_finance_quote(&client, &symbol_upper).await {
        if quote.price > 0.0 {
            return Ok(quote);
        }
    }
    
    // Fallback to MarketWatch
    println!("[web::get_stock_quote] Google Finance failed, trying MarketWatch...");
    fetch_marketwatch_quote(&client, &symbol_upper).await
}

async fn fetch_google_finance_quote(client: &Client, symbol: &str) -> Result<StockQuote, String> {
    // Try different exchanges
    let exchanges = ["NASDAQ", "NYSE", "NYSEARCA", "AMEX"];
    
    for exchange in exchanges {
        let url = format!("https://www.google.com/finance/quote/{}:{}", symbol, exchange);
        
        if let Ok(response) = client.get(&url).send().await {
            if response.status().is_success() {
                if let Ok(html) = response.text().await {
                    if let Ok(quote) = parse_google_finance_html(&html, symbol) {
                        if quote.price > 0.0 {
                            println!("[web::google] Got quote for {} from {}: ${:.2} ({:+.2}%)", 
                                symbol, exchange, quote.price, quote.change_percent);
                            return Ok(quote);
                        }
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    
    println!("[web::google] Failed to get quote for {} from any exchange", symbol);
    Err(format!("Could not find {} on Google Finance", symbol))
}

fn parse_google_finance_html(html: &str, symbol: &str) -> Result<StockQuote, String> {
    let document = Html::parse_document(html);
    
    // Method 1: Try data attributes
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
    
    // Method 2: Try regex patterns if data attributes didn't work
    if price == 0.0 {
        // Look for price in JSON-LD or script tags
        let price_patterns = [
            r#""price"\s*:\s*"?(\d+\.?\d*)""#,
            r#"regularMarketPrice.*?(\d+\.?\d+)"#,
            r#"\$(\d{1,4}\.\d{2})"#,
        ];
        
        for pattern in price_patterns {
            if let Ok(re) = regex::Regex::new(pattern) {
                if let Some(caps) = re.captures(html) {
                    if let Some(m) = caps.get(1) {
                        if let Ok(p) = m.as_str().parse::<f64>() {
                            if p > 0.0 && p < 100000.0 {
                                price = p;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Try to find change percent via regex
    if change_percent == 0.0 && price > 0.0 {
        let change_patterns = [
            r#"([+-]?\d+\.?\d*)\s*%"#,
            r#""percentChange"\s*:\s*"?([+-]?\d+\.?\d*)"#,
        ];
        
        for pattern in change_patterns {
            if let Ok(re) = regex::Regex::new(pattern) {
                if let Some(caps) = re.captures(html) {
                    if let Some(m) = caps.get(1) {
                        if let Ok(pct) = m.as_str().parse::<f64>() {
                            if pct.abs() < 100.0 {
                                change_percent = pct;
                                change = price * change_percent / 100.0;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Get company name from title
    let title_selector = Selector::parse("title").unwrap();
    let name = document.select(&title_selector)
        .next()
        .map(|el| el.text().collect::<String>())
        .map(|t| {
            t.split(" Stock Price")
                .next()
                .or_else(|| t.split(" - Google").next())
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
    let url = format!("https://www.marketwatch.com/investing/stock/{}", symbol.to_lowercase());
    
    println!("[web::marketwatch] Fetching quote for {} from {}", symbol, url);
    
    let response = client.get(&url).send().await
        .map_err(|e| format!("MarketWatch request failed: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("MarketWatch returned status: {}", response.status()));
    }
    
    let html = response.text().await
        .map_err(|e| format!("Failed to read MarketWatch response: {}", e))?;
    
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
