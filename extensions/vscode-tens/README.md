# TENS Format — VS Code Extension

Syntax highlighting, file icons, and language support for `.tens` and `.tens.txt` files.

## Features

- Syntax highlighting for TENS-Text format
- Language registration for `.tens` and `.tens.txt` files
- Auto-closing brackets, quotes, and braces
- Code folding support
- Comment toggling (`#` comments)

## Installation

### From VSIX (local install)

```bash
cd extensions/vscode-tens
npx @vscode/vsce package
code --install-extension vscode-tens-0.1.0.vsix
```

### From Marketplace (after publishing)

Search "TENS Format Support" in VS Code Extensions.

## File Associations

| Extension | Language ID |
|-----------|------------|
| `.tens` | `tens` |
| `.tens.txt` | `tens-text` |
| `.tenstxt` | `tens-text` |

## Publishing to VS Code Marketplace

1. Create a publisher at https://marketplace.visualstudio.com/manage
2. Generate a Personal Access Token (PAT) from Azure DevOps
3. Run: `npx @vscode/vsce login kshitijpalsinghtomar`
4. Run: `npx @vscode/vsce publish`

## Author

Kshitij Pal Singh Tomar ([@kshitijpalsinghtomar](https://github.com/kshitijpalsinghtomar))
