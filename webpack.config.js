const path = require("path");

module.exports = {
  target: "electron-main",
  entry: "./main.js",
  output: {
    path: path.resolve(__dirname, "./build"),
    filename: "main.js",
  },
  optimization: {
    minimize: false,
  },
  node: {
    __dirname: false,
  },
};
