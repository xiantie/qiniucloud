const savedLocation =
  settingsStore.get("savedFileLocation") ||
  join(remote.app.getPath("documents"), "我的md");
