# VS Code extension screenshots

This folder holds the screenshots used by the **VS Code Shell Extension** part of the
[User Guide](../../USER-GUIDE.md). They are intentionally separate from the desktop
screenshots in `../` because the VS Code webview chrome (Activity Bar, editor tab, native
tree, and VS Code theme) looks and feels different from the standalone desktop window.

Capture these from the **Extension Development Host** running in sample mode
(`tlc.mode` = `sample`), then save them with the exact file names below. Once the files
exist, replace the matching `> 📸 Screenshot to add` callouts in
[USER-GUIDE.md](../../USER-GUIDE.md) with standard image embeds, for example:

```markdown
![TLC Assist on the Portfolio tab in VS Code](./media/vscode/01-portfolio.png)
```

| File | What to capture |
| --- | --- |
| `01-portfolio.png` | The TLC Assist view on the **Portfolio** tab — account portfolio, a selected opportunity, and its milestone tree. |
| `02-guidance.png` | A completed **Multi-Agent Guidance** response on the Portfolio tab with the **Email** and **Word** buttons visible. |
| `03-plays-queue.png` | The **Plays** tab — the catalog rail ordered by workflow number and the Operational Queue, including a **Send to Pursuit** action. |
| `04-plays-guidance.png` | A Plays queue item dispatched to an agent, showing the returned response with its **Email** and **Word** export buttons. |

To launch the Extension Development Host: open the repo in VS Code, run
`npm run ext:build`, then press **F5** (or run the **Run Extension** debug configuration).
In the new window, select the **TLC Assist** icon in the Activity Bar or run
**TLC: Open Assist**.
