const { app, Menu, ipcMain, dialog } = require("electron");
const isDev = require("electron-is-dev");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const menuTemplate = require("./src/menuTemplate");
const AppWindow = require("./src/AppWindow");
const Store = require("electron-store");
const QiniuManager = require("./src/utils/QiniuManager");
const uuidv4 = require("uuid").v4;
const settingsStore = new Store({ name: "Settings" });
const fileStore = new Store({ name: "Files Data" });
require("@electron/remote/main").initialize();
let mainWindow, settingsWindow;

const savedLocation =
  settingsStore.get("savedFileLocation") ||
  path.join(app.getPath("documents"), "我的md");

const createManager = () => {
  const accessKey = settingsStore.get("accessKey");
  const secretKey = settingsStore.get("secretKey");
  const bucketName = settingsStore.get("bucketName");
  return new QiniuManager(accessKey, secretKey, bucketName);
};
app.on("ready", () => {
  autoUpdater.autoDownload = false;
  autoUpdater.checkForUpdatesAndNotify();
  autoUpdater.on("error", (error) => {
    dialog.showErrorBox("Error:", error == null ? "unknown" : error.status);
  });
  autoUpdater.on("update-available", () => {
    dialog.showMessageBox(
      {
        type: "info",
        title: "应用有新的版本，是否现在更新?",
        buttons: ["是", "否"],
      },
      (buttonIndex) => {
        if (buttonIndex === 0) {
          autoUpdater.downloadUpdate();
        }
      }
    );
  });
  autoUpdater.on("update-not-available", () => {
    dialog.showMessageBox({
      title: "没有新版本",
      message: "当前已经是最新版本",
    });
  });
  const mainWindowConfig = {
    width: 1440,
    height: 768,
  };

  const urlLocation = isDev
    ? "http://localhost:3000"
    : `file://${path.join(__dirname, "./index.html")}`;
  mainWindow = new AppWindow(mainWindowConfig, urlLocation);

  require("@electron/remote/main").enable(mainWindow.webContents);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  // set the menu
  let menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
  // hook up main events
  ipcMain.on("open-settings-window", () => {
    const settingsWindowConfig = {
      width: 500,
      height: 400,
      parent: mainWindow,
    };
    const settingsFileLocation = `file://${path.join(
      __dirname,
      "../settings/settings.html"
    )}`;
    settingsWindow = new AppWindow(settingsWindowConfig, settingsFileLocation);
    require("@electron/remote/main").enable(settingsWindow.webContents);
    settingsWindow.removeMenu();
    settingsWindow.on("closed", () => {
      settingsWindow = null;
    });
  });
  ipcMain.on("upload-file", (event, data) => {
    const manager = createManager();
    manager
      .uploadFile(data.key, data.path)
      .then((data) => {
        console.log("上传成功", data);
        mainWindow.webContents.send("active-file-uploaded");
      })
      .catch(() => {
        dialog.showErrorBox("同步失败", "请检查七牛云参数是否正确");
      });
  });
  ipcMain.on("download-file", (event, data) => {
    const manager = createManager();
    const filesObj = fileStore.get("files");
    const { key, path, id } = data;
    manager.getStat(data.key).then(
      (resp) => {
        const serverUpdatedTime = Math.round(resp.putTime / 10000);
        const localUpdatedTime = filesObj[id].updatedAt;
        if (serverUpdatedTime > localUpdatedTime || !localUpdatedTime) {
          manager.downloadFile(key, path).then(() => {
            mainWindow.webContents.send("file-downloaded", {
              status: "download-success",
              id,
            });
          });
        } else {
          mainWindow.webContents.send("file-downloaded", {
            status: "no-new-file",
            id,
          });
        }
      },
      (error) => {
        if (error.statusCode === 612) {
          mainWindow.webContents.send("file-downloaded", {
            status: "no-file",
            id,
          });
        }
      }
    );
  });
  ipcMain.on("rename-file", (event, data) => {
    const manager = createManager();
    const { key, newKey } = data;
    manager.renameFile(key, newKey).then((resp) => {
      mainWindow.webContents.send("active-file-stat", newKey);
    });
  });
  ipcMain.on("delete-file", (event, data) => {
    const manager = createManager();
    const { key } = data;
    manager.deleteFile(key).then((resp) => {
      console.log(resp);
    });
  });
  ipcMain.on("download-all-files", () => {
    const manager = createManager();
    // 1 get all cloud filelist
    const objfiles = Object.values(fileStore.get("files")).reduce(
      (map, item) => {
        map[`${item.title}`] = item;
        return map;
      },
      {}
    );
    console.log("objfiles", objfiles);
    let cloudfiles = {};
    manager
      .getFileList()
      .then(({ items }) => {
        // cloudfiles = items
        // console.log(items);
        const downloadPromiseArr = items
          .filter((item) => {
            // 2 判断是否要download ,要比本地新和本地没有的
            const localkey = path.basename(item.key, path.extname(item.key));
            if (
              !objfiles[localkey] ||
              objfiles[localkey].updatedAt < Math.round(item.putTime / 10000)
            ) {
              return true;
            }
          })
          .map((item) => {
            cloudfiles[item.key] = item;
            // 3 使用文件列表生成的下载文件
            return manager.downloadFile(
              item.key,
              path.join(savedLocation, item.key)
            );
          });
        return Promise.all(downloadPromiseArr);
      })
      .then((arr) => {
        // console.log("arr", arr);
        // 4 显示messageBox
        dialog.showMessageBox({
          type: "info",
          title: `成功下载了${arr.length}个文件`,
          message: `成功下载了 ${arr.join(",")}`,
        });
        //5 生成新的filesobject
        const finalFilesObj = arr.reduce((newFilesObj, qiniufileKey) => {
          // console.log("qiniufileKey", qiniufileKey);
          const localkey = path.basename(
            qiniufileKey,
            path.extname(qiniufileKey)
          );
          let updatedItem;
          if (!!objfiles[localkey]) {
            //如果qiniuFile已存在本地，则更新记录
            updatedItem = {
              ...objfiles[localkey],
              updatedAt: Math.round(cloudfiles[qiniufileKey].putTime / 10000),
              isSynced: true,
            };
          } else {
            //如果不存在，则新增记录
            updatedItem = {
              id: uuidv4(),
              path: path.join(savedLocation, qiniufileKey),
              title: path.basename(qiniufileKey, path.extname(qiniufileKey)),
              createdAt: Math.round(cloudfiles[qiniufileKey].putTime / 10000),
              updatedAt: Math.round(cloudfiles[qiniufileKey].putTime / 10000),
              isSynced: true,
            };
          }
          newFilesObj[updatedItem.id] = updatedItem;
          return newFilesObj;
        }, {});
        // console.log("finalFilesObj", finalFilesObj);
        mainWindow.webContents.send("active-download-all-file", finalFilesObj);
      });
  });
  ipcMain.on("upload-all-to-qiniu", () => {
    mainWindow.webContents.send("loading-status", true);
    const manager = createManager();
    const filesObj = fileStore.get("files") || {};
    const uploadPromiseArr = Object.keys(filesObj).map((key) => {
      const file = filesObj[key];
      return manager.uploadFile(`${file.title}.md`, file.path);
    });
    Promise.all(uploadPromiseArr)
      .then((result) => {
        console.log(result);
        // show uploaded message
        dialog.showMessageBox({
          type: "info",
          title: `成功上传了${result.length}个文件`,
          message: `成功上传了${result.length}个文件`,
        });
        mainWindow.webContents.send("files-uploaded");
      })
      .catch(() => {
        dialog.showErrorBox("同步失败", "请检查七牛云参数是否正确");
      })
      .finally(() => {
        mainWindow.webContents.send("loading-status", false);
      });
  });
  ipcMain.on("config-is-saved", () => {
    // watch out menu items index for mac and windows
    let qiniuMenu =
      process.platform === "darwin" ? menu.items[3] : menu.items[2];
    const switchItems = (toggle) => {
      [1, 2, 3].forEach((number) => {
        qiniuMenu.submenu.items[number].enabled = toggle;
      });
    };
    const qiniuIsConfiged = ["accessKey", "secretKey", "bucketName"].every(
      (key) => !!settingsStore.get(key)
    );
    if (qiniuIsConfiged) {
      switchItems(true);
    } else {
      switchItems(false);
    }
  });
});
