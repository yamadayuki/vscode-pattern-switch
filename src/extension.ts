// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const cachedConfig: {
    rules?: Rule[];
  } = {};

  function getRules(): Rule[] {
    if (!cachedConfig.rules) {
      const config = vscode.workspace.getConfiguration("patternSwitch");
      cachedConfig.rules = computeRules(config);
    }
    return cachedConfig.rules;
  }

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration("patternSwitch.replaceRules") || e.affectsConfiguration("patternSwitch.toggleRules")) {
      cachedConfig.rules = undefined;
    }
  }));

  context.subscriptions.push(vscode.commands.registerTextEditorCommand(
    "patternSwitch.switchUnderCursor",
    textEditor => {
      const rules = getRules();
      switchUnderCursor(textEditor, rules);
    }
  ));
}

// this method is called when your extension is deactivated
export function deactivate() {}

type CursorMovement = "keep" | "contained" | "start" | "end";

interface Config {
  replaceRules: {
    from: string;
    to: string;
    caseSensitive?: boolean;
    cursor?: CursorMovement;
  }[];
  toggleRules: string[][];
}

interface Rule {
  from: RegExp;
  to: string;
  cursor: CursorMovement;
}

function computeRules(config: vscode.WorkspaceConfiguration): Rule[] {
  const replaceRules: Config["replaceRules"] = config.get("replaceRules") || [];
  const toggleRules: Config["toggleRules"] = config.get("toggleRules") || [];

  const rules: Rule[] = [];

  for (const rule of replaceRules) {
    rules.push({
      from: new RegExp(rule.from, rule.caseSensitive === true ? "" : "i"),
      to: rule.to,
      cursor: rule.cursor || "contained",
    });
  }

  for (const toggle of toggleRules) {
    const len = toggle.length;
    for (let i = 0; i < len; i++) {
      const current = toggle[i];
      const next = toggle[(i + 1) % len];
      rules.push({
        from: new RegExp(`\\b${escapeRegexp(current)}\\b`, ""),
        to: escapeSubstitution(next),
        cursor: "contained",
      });
    }
  }

  return rules;
}

interface Match {
  start: number;
  end: number;
  cursor: CursorMovement;
  substitution: string;
}

function substitute(textEditor: vscode.TextEditor, anchorPosition: vscode.Position, match: Match) {
  const range = new vscode.Range(
    anchorPosition.line,
    match.start,
    anchorPosition.line,
    match.end,
  );

  textEditor
    .edit(builder => builder.replace(range, match.substitution), { undoStopBefore: true, undoStopAfter: true })
    .then(() => {
      switch (match.cursor) {
        case "keep": {
          textEditor.selection = new vscode.Selection(anchorPosition, anchorPosition);
          break;
        }
        case "contained": {
          let pos = new vscode.Position(anchorPosition.line, match.start + match.substitution.length);
          if (pos.character > anchorPosition.character) {
            pos = anchorPosition;
          }
          textEditor.selection = new vscode.Selection(pos, pos);
          break;
        }
        case "start": {
          const pos = new vscode.Position(anchorPosition.line, match.start);
          textEditor.selection = new vscode.Selection(pos, pos);
          break;
        }
        case "end": {
          const pos = new vscode.Position(anchorPosition.line, match.start + match.substitution.length);
          textEditor.selection = new vscode.Selection(pos, pos);
          break;
        }
      }
    });
}

function switchUnderCursor(textEditor: vscode.TextEditor, rules: Rule[]) {
  if (textEditor.selections.length !== 1) {
    return;
  }

  const selection = textEditor.selection;
  if (!selection.isEmpty) {
    return;
  }

  const lineText = textEditor.document.lineAt(selection.anchor.line).text;

  let finalMatch: Match | undefined;
  for (const rule of rules) {
    const match = lineText.match(rule.from);
    if (!match) {
      continue;
    }

    const start = match.index || 0;
    const end = start + match[0].length;
    if (start > selection.anchor.character || selection.anchor.character > end) {
      continue;
    }
    if (finalMatch && (end - start) > (finalMatch.end - finalMatch.start)) {
      continue;
    }

    finalMatch = {
      start,
      end,
      cursor: rule.cursor,
      substitution: replacePlaceholders(rule.to, match),
    };
  }

  if (!finalMatch) {
    return;
  }
  substitute(textEditor, selection.anchor, finalMatch);
}

function escapeRegexp(str: string): string {
	return str.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
}

function escapeSubstitution(str: string): string {
  return str.replace(/(?<!\$)\$(\d+)/g, '$$$$$1');
}

function replacePlaceholders(str: string, placeholders: string[]) {
  return str
    .replace(/(?<!\$)\$(\d+)/g, (_0, _1) => placeholders[+_1])
    .replace(/\$(\$\d+)/g, '$1');
}
