# Corrections Log

Append an entry whenever a tool call, command, or API usage went wrong and needed a retry.
Format: `- ❌ [what wrong] → ✅ [fix] (brief reason)`

- ❌ Assumed Google Drive vault reachable at `/mnt/g` in WSL → ✅ G: is not auto-mounted; read it via `powershell.exe -Command "Get-Content -LiteralPath 'G:\...'"` or copy to a `/mnt/c` path first (only fixed drives get drvfs mounts, and `sudo mount` needs an interactive password)
- ❌ Ran `gh issue create --label needs-triage` against a repo lacking that label → ✅ check `gh label list --repo <r>` first; label creation is per-repo and `/setup` only creates a subset
- ❌ Passed `2>&1` inside the shell tool's command string with no shell wrapper → ✅ the tool spawns directly without a shell in some cases; keep redirection out of simple commands or wrap in `bash -c`
