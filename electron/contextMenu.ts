import { Menu, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from "electron";

export function showDefaultContextMenu(input: {
  window: BrowserWindow;
  webContents: WebContents;
  params: ContextMenuParams;
}) {
  const template: MenuItemConstructorOptions[] = [];

  if (input.params.misspelledWord) {
    for (const suggestion of input.params.dictionarySuggestions.slice(0, 5)) {
      template.push({
        label: suggestion,
        click: () => input.webContents.replaceMisspelling(suggestion),
      });
    }
    if (input.params.dictionarySuggestions.length === 0) {
      template.push({ label: "No suggestions", enabled: false });
    }
    template.push({ type: "separator" });
  }

  if (input.params.mediaType === "image") {
    template.push({
      label: "Copy Image",
      click: () => input.webContents.copyImageAt(input.params.x, input.params.y),
    });
    template.push({ type: "separator" });
  }

  template.push(
    { role: "cut", enabled: input.params.editFlags.canCut },
    { role: "copy", enabled: input.params.editFlags.canCopy },
    { role: "paste", enabled: input.params.editFlags.canPaste },
    { role: "selectAll", enabled: input.params.editFlags.canSelectAll },
  );

  Menu.buildFromTemplate(template).popup({ window: input.window });
}
