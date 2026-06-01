# Troubleshooting

Common issues and solutions for OpenCodeBrew.

## AI Issues

### AI not responding

**Symptoms:** Messages don't get responses, spinner keeps spinning

**Solutions:**
1. Check your internet connection (for cloud providers)
2. Verify API key is correct in Settings
3. For Ollama: Ensure it's running (`ollama serve`)
4. Check if you have API credits (OpenAI/Anthropic)
5. Try a different model

### "Invalid API key" error

**Solutions:**
1. Regenerate your API key from the provider's dashboard
2. Ensure no extra spaces when pasting
3. Check the key hasn't expired or been revoked

### Slow AI responses

**Solutions:**
1. Use a smaller/faster model
2. Reduce max tokens setting
3. For Ollama: Use a smaller model or upgrade hardware
4. Check network connection for cloud providers

### AI hallucinating data (stock prices, etc.)

**Solutions:**
1. Lower the temperature setting (try 0.3-0.5)
2. Enable tool use for real-time data
3. Be explicit in prompts: "Use only data from tools"

## IDE Issues

### Files not saving

**Solutions:**
1. Check file permissions
2. Ensure disk has free space
3. Try "Save As" to a different location
4. Check if file is locked by another process

### Editor slow or laggy

**Solutions:**
1. Close unused tabs
2. Disable minimap for large files
3. Increase memory allocation in settings
4. Restart the application

### Git operations failing

**Solutions:**
1. Verify git is configured: `git config --list`
2. Check repository permissions
3. Ensure remote URL is correct
4. For SSH: Verify your SSH key is added

### Terminal not working

**Solutions:**
1. Check your default shell is installed
2. On macOS: Grant terminal access in System Preferences
3. Try restarting the terminal
4. Check PATH environment variable

## Assistant Issues

### Agent stuck "running"

**Solutions:**
1. Click "Cancel" in Execution History
2. Check if external APIs are responding
3. Review action timeout settings
4. Restart the application

### Scheduled agents not triggering

**Solutions:**
1. Verify the cron expression is correct
2. Ensure the agent is enabled (toggle is on)
3. Check system time/timezone
4. Restart the application to reload schedules

### Notifications not sending

**Discord:**
1. Verify webhook URL is correct
2. Check Discord server permissions
3. Ensure webhook hasn't been deleted

**Slack:**
1. Verify webhook URL is correct
2. Check workspace permissions
3. Ensure the app is still installed

**Email:**
1. Verify SMTP settings
2. Check username/password
3. Enable "Less secure apps" if using Gmail
4. Try a different SMTP port (587, 465)

## Notes Issues

### Conversations not saving

**Solutions:**
1. Check disk space
2. Verify app data directory permissions
3. Try creating a new workspace

### Attachments not loading

**Solutions:**
1. Check file size (max 10MB for images)
2. Verify file format is supported
3. Try re-attaching the file

## General Issues

### Application won't start

**macOS:**
1. Right-click → Open (first time)
2. Check System Preferences → Security
3. Try: `xattr -cr /Applications/OpenCodeBrew.app`

**Windows:**
1. Run as Administrator
2. Check Windows Defender isn't blocking
3. Install Visual C++ Redistributable

**Linux:**
1. Check dependencies: `ldd /path/to/opencodebrew`
2. Install missing libraries
3. For AppImage: `chmod +x` before running

### High memory usage

**Solutions:**
1. Close unused apps/tabs
2. Reduce history retention
3. Clear AI conversation cache
4. Restart the application

### Application crashes

**Solutions:**
1. Update to latest version
2. Reset settings: Delete config folder and restart
3. Check system logs for errors
4. Report issue on GitHub with crash details

## Getting Help

If your issue isn't listed here:

1. **Search existing issues:** [GitHub Issues](https://github.com/stan-lam/opencode-brew/issues)
2. **Ask the community:** [GitHub Discussions](https://github.com/stan-lam/opencode-brew/discussions)
3. **Report a bug:** Create a new issue with:
   - OpenCodeBrew version
   - Operating system and version
   - Steps to reproduce
   - Error messages or screenshots

## Reset to Defaults

If all else fails, reset OpenCodeBrew to defaults:

**macOS:**
```bash
rm -rf ~/Library/Application\ Support/opencodebrew
```

**Windows:**
```
Delete %APPDATA%\opencodebrew
```

**Linux:**
```bash
rm -rf ~/.config/opencodebrew
```

⚠️ **Warning:** This deletes all settings, history, and local data. Export important conversations first.
