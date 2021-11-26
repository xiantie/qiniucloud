const fs = window.require("fs").promises;
const { join } = window.require("path");
const { lstatSync } = window.require("fs");

const fileHelper = {
  readFile: (path) => {
    return fs.readFile(path, { encoding: "utf8" });
  },
  writeFile: (path, content) => {
    return fs.writeFile(path, content, { encoding: "utf8" });
  },
  renameFile: (path, newPath) => {
    return fs.rename(path, newPath);
  },
  deleteFile: (path) => {
    return fs.unlink(path);
  },
  readDir: (path) => {
    return fs.readdir(path).then((files) => {
      const list = files
        .map((file) => join(path, file))
        .filter((file) => lstatSync(file).isFile());
      return list;
    });
  },
};

export default fileHelper;
