#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m'
};

function log(msg) {
  console.log(`${colors.cyan}[skills-cli]${colors.reset} ${msg}`);
}

function success(msg) {
  console.log(`${colors.green}[skills-cli] Success: ${msg}${colors.reset}`);
}

function warn(msg) {
  console.warn(`${colors.yellow}[skills-cli] Warning: ${msg}${colors.reset}`);
}

function errorExit(msg) {
  console.error(`${colors.red}[skills-cli] Error: ${msg}${colors.reset}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || command !== 'add') {
  errorExit("Invalid command. Usage: npx skills add <repository-url> --skill <skill-name>");
}

let repoUrl = args[1];
if (!repoUrl) {
  errorExit("Please provide a repository URL or GitHub shorthand. Example: npx skills add heysourin/user-pain-radar");
}

if (!repoUrl.startsWith('http://') && !repoUrl.startsWith('https://') && !repoUrl.includes('@')) {
  if (repoUrl.includes('/')) {
    repoUrl = `https://github.com/${repoUrl}.git`;
  } else {
    errorExit(`Invalid repository format "${repoUrl}". Please provide a full URL or 'owner/repo' shorthand.`);
  }
}

let skillName = '*';
const skillIndex = args.indexOf('--skill');
if (skillIndex !== -1 && args[skillIndex + 1]) {
  skillName = args[skillIndex + 1];
}

const homeDir = os.homedir();
const projectDir = process.env.INIT_CWD || process.cwd();

const targetDirs = [
  path.join(homeDir, '.agents', 'skills'),
  path.join(homeDir, '.claude', 'skills'),
  path.join(projectDir, '.agents', 'skills'),
  path.join(projectDir, '.claude', 'skills')
];

const uniqueTargets = Array.from(new Set(targetDirs));

const tempDirName = `skills-temp-${Date.now()}`;
const tempDir = path.join(os.tmpdir(), tempDirName);

log(`Cloning repository ${repoUrl} to a temporary location...`);

try {
  execSync(`git clone --depth 1 ${repoUrl} "${tempDir}"`, { stdio: 'ignore' });
} catch (err) {
  errorExit(`Failed to clone git repository. Details: ${err.message}`);
}

function getFilesRecursively(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (file === '.git') continue;
    
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      getFilesRecursively(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  }
  return fileList;
}

function isSkillFile(filePath, specificName = '*') {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.startsWith('---')) return false;
    
    const endFrontmatterIndex = content.indexOf('---', 3);
    if (endFrontmatterIndex === -1) return false;
    
    const frontmatter = content.substring(3, endFrontmatterIndex);
    const nameMatch = frontmatter.match(/name:\s*['"]?([a-zA-Z0-9-_*]+)['"]?/);
    if (!nameMatch) return false;
    
    const parsedName = nameMatch[1].trim();
    
    if (specificName === '*') {
      return { isValid: true, skillName: parsedName };
    }
    
    if (parsedName.toLowerCase() === specificName.toLowerCase()) {
      return { isValid: true, skillName: parsedName };
    }
    
    const baseName = path.basename(filePath, '.md');
    if (baseName.toLowerCase() === specificName.toLowerCase()) {
      return { isValid: true, skillName: baseName };
    }
  } catch (e) {
    // Ignore read errors
  }
  return false;
}

function copyDirRecursively(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src);
  for (const entry of entries) {
    if (entry === '.git' || entry === '__pycache__' || entry === 'node_modules') continue;
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyDirRecursively(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

try {
  log("Scanning repository for skills...");
  const allFiles = getFilesRecursively(tempDir);
  const foundSkills = [];

  for (const file of allFiles) {
    if (file.endsWith('.md')) {
      const match = isSkillFile(file, skillName);
      if (match) {
        foundSkills.push({
          sourcePath: file,
          sourceDir: path.dirname(file),
          skillName: match.skillName
        });
      }
    }
  }

  if (foundSkills.length === 0) {
    if (skillName === '*') {
      warn("No skills found in the repository.");
    } else {
      warn(`No skill matching "${skillName}" was found in the repository.`);
    }
  } else {
    log(`Found ${foundSkills.length} skill(s) to install.`);
    
    uniqueTargets.forEach((targetDir) => {
      try {
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
          log(`Created directory: ${targetDir}`);
        }

        foundSkills.forEach((skill) => {
          const destinationFile = path.join(targetDir, `${skill.skillName}.md`);
          fs.copyFileSync(skill.sourcePath, destinationFile);
          log(`Installed ${skill.skillName} -> ${destinationFile}`);

          const siblingEntries = fs.readdirSync(skill.sourceDir);
          for (const entry of siblingEntries) {
            const entryPath = path.join(skill.sourceDir, entry);
            const stat = fs.statSync(entryPath);
            if (stat.isDirectory() && entry !== '.git' && entry !== 'node_modules' && entry !== '__pycache__') {
              const destSubDir = path.join(targetDir, skill.skillName, entry);
              copyDirRecursively(entryPath, destSubDir);
              log(`  └─ Copied companion: ${entry}/ -> ${destSubDir}`);
            }
          }
        });
      } catch (err) {
        warn(`Could not install to directory ${targetDir}: ${err.message}`);
      }
    });

    success(`Successfully installed ${foundSkills.map(s => s.skillName).join(', ')}!`);
  }
} catch (err) {
  warn(`An error occurred during skill installation: ${err.message}`);
} finally {
  try {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } catch (err) {
    // Ignore cleanup error
  }
}
