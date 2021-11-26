const path = require("path");
// const nodeExternals = require('webpack-node-externals');

module.exports = {
  target: "electron-main",
  entry: "./main.js",
  output: {
    path: path.resolve(__dirname, "./build"),
    filename: "main.js",
  },
  externals: [/vm2/], // 排除vm2模块
  // optimization: {
  //   minimize: false,
  // },
  node: {
    __dirname: false,
  },
};
