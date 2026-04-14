use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tauri::command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub project_type: String,
    pub name: String,
    pub build_command: Option<String>,
    pub run_command: Option<String>,
    pub install_command: Option<String>,
    pub clean_command: Option<String>,
    pub scripts: HashMap<String, String>,
    pub has_dependencies: bool,
    pub dependencies_installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmPackageJson {
    pub name: Option<String>,
    pub scripts: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CargoToml {
    pub package: Option<CargoPackage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CargoPackage {
    pub name: Option<String>,
}

#[command]
pub async fn detect_project(path: String) -> Result<ProjectInfo, String> {
    let project_path = Path::new(&path);
    
    // Check for different project types in order of specificity
    
    // Node.js / npm
    let package_json = project_path.join("package.json");
    if package_json.exists() {
        return detect_npm_project(&path, &package_json).await;
    }
    
    // Rust / Cargo
    let cargo_toml = project_path.join("Cargo.toml");
    if cargo_toml.exists() {
        return detect_cargo_project(&path, &cargo_toml).await;
    }
    
    // Python
    let pyproject = project_path.join("pyproject.toml");
    let requirements = project_path.join("requirements.txt");
    let setup_py = project_path.join("setup.py");
    if pyproject.exists() || requirements.exists() || setup_py.exists() {
        return detect_python_project(&path, pyproject.exists(), requirements.exists());
    }
    
    // Go
    let go_mod = project_path.join("go.mod");
    if go_mod.exists() {
        return detect_go_project(&path, &go_mod).await;
    }
    
    // Java / Maven
    let pom_xml = project_path.join("pom.xml");
    if pom_xml.exists() {
        return Ok(ProjectInfo {
            project_type: "maven".to_string(),
            name: project_path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project")
                .to_string(),
            build_command: Some("mvn compile".to_string()),
            run_command: Some("mvn exec:java".to_string()),
            install_command: Some("mvn install".to_string()),
            clean_command: Some("mvn clean".to_string()),
            scripts: HashMap::new(),
            has_dependencies: true,
            dependencies_installed: project_path.join("target").exists(),
        });
    }
    
    // Java / Gradle
    let build_gradle = project_path.join("build.gradle");
    let build_gradle_kts = project_path.join("build.gradle.kts");
    if build_gradle.exists() || build_gradle_kts.exists() {
        return Ok(ProjectInfo {
            project_type: "gradle".to_string(),
            name: project_path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project")
                .to_string(),
            build_command: Some("./gradlew build".to_string()),
            run_command: Some("./gradlew run".to_string()),
            install_command: Some("./gradlew dependencies".to_string()),
            clean_command: Some("./gradlew clean".to_string()),
            scripts: HashMap::new(),
            has_dependencies: true,
            dependencies_installed: project_path.join("build").exists(),
        });
    }
    
    // C/C++ CMake
    let cmake_lists = project_path.join("CMakeLists.txt");
    if cmake_lists.exists() {
        return Ok(ProjectInfo {
            project_type: "cmake".to_string(),
            name: project_path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project")
                .to_string(),
            build_command: Some("cmake --build build".to_string()),
            run_command: Some("./build/main".to_string()),
            install_command: Some("cmake -B build".to_string()),
            clean_command: Some("rm -rf build".to_string()),
            scripts: HashMap::new(),
            has_dependencies: false,
            dependencies_installed: project_path.join("build").exists(),
        });
    }
    
    // Makefile
    let makefile = project_path.join("Makefile");
    if makefile.exists() {
        return Ok(ProjectInfo {
            project_type: "make".to_string(),
            name: project_path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project")
                .to_string(),
            build_command: Some("make".to_string()),
            run_command: Some("make run".to_string()),
            install_command: None,
            clean_command: Some("make clean".to_string()),
            scripts: HashMap::new(),
            has_dependencies: false,
            dependencies_installed: true,
        });
    }
    
    // Unknown project type
    Ok(ProjectInfo {
        project_type: "unknown".to_string(),
        name: project_path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("project")
            .to_string(),
        build_command: None,
        run_command: None,
        install_command: None,
        clean_command: None,
        scripts: HashMap::new(),
        has_dependencies: false,
        dependencies_installed: true,
    })
}

async fn detect_npm_project(path: &str, package_json_path: &Path) -> Result<ProjectInfo, String> {
    let content = std::fs::read_to_string(package_json_path)
        .map_err(|e| format!("Failed to read package.json: {}", e))?;
    
    let package: NpmPackageJson = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse package.json: {}", e))?;
    
    let mut scripts = HashMap::new();
    if let Some(pkg_scripts) = package.scripts {
        scripts = pkg_scripts;
    }
    
    let project_path = Path::new(path);
    let node_modules = project_path.join("node_modules");
    
    // Determine best run/build commands from scripts
    let run_command = if scripts.contains_key("dev") {
        Some("npm run dev".to_string())
    } else if scripts.contains_key("start") {
        Some("npm start".to_string())
    } else {
        None
    };
    
    let build_command = if scripts.contains_key("build") {
        Some("npm run build".to_string())
    } else {
        None
    };
    
    Ok(ProjectInfo {
        project_type: "npm".to_string(),
        name: package.name.unwrap_or_else(|| "project".to_string()),
        build_command,
        run_command,
        install_command: Some("npm install".to_string()),
        clean_command: Some("rm -rf node_modules".to_string()),
        scripts,
        has_dependencies: true,
        dependencies_installed: node_modules.exists(),
    })
}

async fn detect_cargo_project(path: &str, cargo_toml_path: &Path) -> Result<ProjectInfo, String> {
    let content = std::fs::read_to_string(cargo_toml_path)
        .map_err(|e| format!("Failed to read Cargo.toml: {}", e))?;
    
    let cargo: CargoToml = toml::from_str(&content)
        .map_err(|e| format!("Failed to parse Cargo.toml: {}", e))?;
    
    let project_path = Path::new(path);
    let target = project_path.join("target");
    
    let name = cargo.package
        .and_then(|p| p.name)
        .unwrap_or_else(|| "project".to_string());
    
    Ok(ProjectInfo {
        project_type: "cargo".to_string(),
        name,
        build_command: Some("cargo build".to_string()),
        run_command: Some("cargo run".to_string()),
        install_command: Some("cargo fetch".to_string()),
        clean_command: Some("cargo clean".to_string()),
        scripts: HashMap::new(),
        has_dependencies: true,
        dependencies_installed: target.exists(),
    })
}

fn detect_python_project(path: &str, has_pyproject: bool, has_requirements: bool) -> Result<ProjectInfo, String> {
    let project_path = Path::new(path);
    let venv = project_path.join("venv");
    let dot_venv = project_path.join(".venv");
    
    let install_command = if has_pyproject {
        Some("pip install -e .".to_string())
    } else if has_requirements {
        Some("pip install -r requirements.txt".to_string())
    } else {
        None
    };
    
    Ok(ProjectInfo {
        project_type: "python".to_string(),
        name: project_path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("project")
            .to_string(),
        build_command: None,
        run_command: Some("python main.py".to_string()),
        install_command,
        clean_command: Some("rm -rf __pycache__ *.pyc".to_string()),
        scripts: HashMap::new(),
        has_dependencies: has_requirements || has_pyproject,
        dependencies_installed: venv.exists() || dot_venv.exists(),
    })
}

async fn detect_go_project(path: &str, go_mod_path: &Path) -> Result<ProjectInfo, String> {
    let project_path = Path::new(path);
    
    // Try to extract module name from go.mod
    let content = std::fs::read_to_string(go_mod_path).unwrap_or_default();
    let name = content.lines()
        .find(|line| line.starts_with("module "))
        .map(|line| line.trim_start_matches("module ").trim().to_string())
        .unwrap_or_else(|| {
            project_path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project")
                .to_string()
        });
    
    Ok(ProjectInfo {
        project_type: "go".to_string(),
        name,
        build_command: Some("go build".to_string()),
        run_command: Some("go run .".to_string()),
        install_command: Some("go mod download".to_string()),
        clean_command: Some("go clean".to_string()),
        scripts: HashMap::new(),
        has_dependencies: true,
        dependencies_installed: project_path.join("go.sum").exists(),
    })
}

#[command]
pub async fn get_npm_scripts(path: String) -> Result<HashMap<String, String>, String> {
    let package_json = Path::new(&path).join("package.json");
    
    if !package_json.exists() {
        return Ok(HashMap::new());
    }
    
    let content = std::fs::read_to_string(&package_json)
        .map_err(|e| format!("Failed to read package.json: {}", e))?;
    
    let package: NpmPackageJson = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse package.json: {}", e))?;
    
    Ok(package.scripts.unwrap_or_default())
}
