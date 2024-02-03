const path = require("path");

module.exports = {
  mode: "production",
  entry: "./src/index.js",
  output: {
    filename: "main.js",
    path: path.resolve(__dirname, "docs"),
    publicPath: "docs",
  },
  devServer: {
    static: {
      directory: path.join(__dirname, '/')
    }
  }
};
