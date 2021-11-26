import React, { useState } from "react";
import { faPlus, faFileImport } from "@fortawesome/free-solid-svg-icons";
import SimpleMDE from "react-simplemde-editor";
import { v4 as uuidv4 } from "uuid";
import { flattenArr, objToArr, timestampToString } from "./utils/helper";
import fileHelper from "./utils/fileHelper";
import "./App.css";
import "bootstrap/dist/css/bootstrap.min.css";
import "easymde/dist/easymde.min.css";

import FileSearch from "./components/FileSearch";
import FileList from "./components/FileList";
import BottomBtn from "./components/BottomBtn";
import TabList from "./components/TabList";
import Loader from "./components/Loader";
import useIpcRenderer from "./hooks/useIpcRenderer";
// require node.js modules
const { join, basename, extname, dirname } = window.require("path");
const remote = window.require("@electron/remote");
const { ipcRenderer } = window.require("electron");
const Store = window.require("electron-store");
const fileStore = new Store({ name: "Files Data" });
const settingsStore = new Store({ name: "Settings" });
// fileStore.delete("files");
// settingsStore.delete("savedFileLocation");
const getAutoSync = () =>
  ["accessKey", "secretKey", "bucketName", "enableAutoSync"].every(
    (key) => !!settingsStore.get(key)
  );
const saveFilesToStore = (files) => {
  // we don't have to store any info in file system, eg: isNew, body ,etc
  const filesStoreObj = objToArr(files).reduce((result, file) => {
    const { id, path, title, createdAt, isSynced, updatedAt } = file;
    result[id] = {
      id,
      path,
      title,
      createdAt,
      isSynced,
      updatedAt,
    };
    return result;
  }, {});
  fileStore.set("files", filesStoreObj);
};

function App() {
  const [files, setFiles] = useState(fileStore.get("files") || {});
  const [activeFileID, setActiveFileID] = useState("");
  const [openedFileIDs, setOpenedFileIDs] = useState([]);
  const [unsavedFileIDs, setUnsavedFileIDs] = useState([]);
  const [searchedFiles, setSearchedFiles] = useState([]);
  const [isLoading, setLoading] = useState(false);
  const filesArr = objToArr(files);
  const savedLocation =
    settingsStore.get("savedFileLocation") ||
    join(remote.app.getPath("documents"), "我的md");
  const activeFile = files[activeFileID];
  const openedFiles = openedFileIDs.map((openID) => {
    return files[openID];
  });
  const fileListArr = searchedFiles.length > 0 ? searchedFiles : filesArr;

  const fileClick = (fileID) => {
    // set current active file
    setActiveFileID(fileID);
    const currentFile = files[fileID];
    const { id, title, path, isLoaded } = currentFile;
    if (!isLoaded) {
      if (getAutoSync()) {
        ipcRenderer.send("download-file", { key: `${title}.md`, path, id });
      } else {
        fileHelper
          .readFile(currentFile.path)
          .then((value) => {
            const newFile = { ...files[fileID], body: value, isLoaded: true };
            setFiles({ ...files, [fileID]: newFile });
          })
          .catch((e) => {
            //找不到文件，则删缓存
            const { [fileID]: value, ...afterDelete } = files;
            setFiles(afterDelete);
            saveFilesToStore(afterDelete);
            // close the tab if opened
            tabClose(fileID);
          });
      }
    }
    // if openedFiles don't have the current ID
    // then add new fileID to openedFiles
    if (!openedFileIDs.includes(fileID)) {
      setOpenedFileIDs([...openedFileIDs, fileID]);
    }
  };

  const tabClick = (fileID) => {
    // set current active file
    setActiveFileID(fileID);
  };

  const tabClose = (id) => {
    //remove current id from openedFileIDs
    const tabsWithout = openedFileIDs.filter((fileID) => fileID !== id);
    setOpenedFileIDs(tabsWithout);
    // set the active to the first opened tab if still tabs left
    if (tabsWithout.length > 0) {
      setActiveFileID(tabsWithout[0]);
    } else {
      setActiveFileID("");
    }
  };

  const fileChange = (id, value) => {
    if (value !== files[id].body) {
      const newFile = { ...files[id], body: value };
      setFiles({ ...files, [id]: newFile });
      // update unsavedIDs
      if (!unsavedFileIDs.includes(id)) {
        setUnsavedFileIDs([...unsavedFileIDs, id]);
      }
    }
  };
  const deleteFile = (id) => {
    if (files[id].isNew) {
      const { [id]: value, ...afterDelete } = files;
      setFiles(afterDelete);
    } else {
      fileHelper.deleteFile(files[id].path).then(() => {
        const { [id]: value, ...afterDelete } = files;
        setFiles(afterDelete);
        saveFilesToStore(afterDelete);
        // close the tab if opened
        tabClose(id);
        if (getAutoSync() && value.isSynced) {
          ipcRenderer.send("delete-file", {
            key: `${basename(value.path)}`,
          });
        }
      });
    }
  };
  const updateFileName = (id, title, isNew) => {
    // if the filename is 重复
    if (
      Object.keys(files).some(
        (fileId) => files[fileId].title === title && fileId !== id
      )
    ) {
      // alert(`该文件名 ${title} 已存在，请换别的名字`);
      remote.dialog.showMessageBox({
        type: "info",
        title: `文件名重复`,
        message: `该文件名 ${title} 已存在，请换别的名字`,
      });
      return false;
    }
    // newPath should be different based on isNew
    // if isNew is false, path should be old dirname + new title
    const newPath = isNew
      ? join(savedLocation, `${title}.md`)
      : join(dirname(files[id].path), `${title}.md`);
    const modifiedFile = { ...files[id], title, isNew: false, path: newPath };
    const newFiles = { ...files, [id]: modifiedFile };
    if (isNew) {
      fileHelper.writeFile(newPath, files[id].body).then(() => {
        setFiles(newFiles);
        saveFilesToStore(newFiles);
      });
    } else {
      const oldPath = files[id].path;
      fileHelper.renameFile(oldPath, newPath).then(() => {
        setFiles(newFiles);
        saveFilesToStore(newFiles);
        if (getAutoSync() && files[id].isSynced) {
          ipcRenderer.send("rename-file", {
            key: `${basename(oldPath)}`,
            newKey: `${title}.md`,
          });
        }
      });
    }
  };
  const fileSearch = (keyword) => {
    // filter out the new files based on the keyword
    if (keyword === "") {
      setSearchedFiles([]);
      return false;
    }
    const newFiles = filesArr.filter((file) => file.title.includes(keyword));
    setSearchedFiles(newFiles);
  };

  const createNewFile = () => {
    // if (Object.keys(files).some((fileId) => files[fileId].isNew)) {
    //   return false;
    // }

    const newID = uuidv4();
    const newFile = {
      id: newID,
      title: "",
      body: "## 请输出 Markdown",
      createdAt: new Date().getTime(),
      isNew: true,
    };
    setFiles({ ...files, [newID]: newFile });
  };
  const saveCurrentFile = () => {
    const { path, body, title } = activeFile;
    fileHelper.writeFile(path, body).then(() => {
      setUnsavedFileIDs(unsavedFileIDs.filter((id) => id !== activeFile.id));
      if (getAutoSync()) {
        ipcRenderer.send("upload-file", { key: `${title}.md`, path });
      }
    });
  };
  const importFiles = () => {
    remote.dialog
      .showOpenDialog({
        title: "选择导入的 Markdown 文件",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Markdown files", extensions: ["md"] }],
      })
      .then(({ filePaths }) => {
        if (Array.isArray(filePaths)) {
          // filter out the path we already have in electron store
          // ["/Users/liusha/Desktop/name1.md", "/Users/liusha/Desktop/name2.md"]
          const filteredPaths = filePaths.filter((filePath) => {
            const alreadyAdded = Object.values(files).find((file) => {
              return file.path === filePath;
            });
            return !alreadyAdded;
          });
          // extend the path array to an array contains files info
          // [{id: '1', path: '', title: ''}, {}]
          const importFilesArr = filteredPaths.map((filePath) => {
            return {
              id: uuidv4(),
              title: basename(filePath, extname(filePath)),
              path: filePath,
            };
          });
          // get the new files object in flattenArr
          const newFiles = { ...files, ...flattenArr(importFilesArr) };
          // setState and update electron store
          setFiles(newFiles);
          saveFilesToStore(newFiles);
          if (importFilesArr.length > 0) {
            remote.dialog.showMessageBox({
              type: "info",
              title: `成功导入了${importFilesArr.length}个文件`,
              message: `成功导入了${importFilesArr.length}个文件`,
            });
          }
        }
      });
  };
  const activeFileUploaded = () => {
    const { id } = activeFile;
    const modifiedFile = {
      ...files[id],
      isSynced: true,
      updatedAt: new Date().getTime(),
    };
    const newFiles = { ...files, [id]: modifiedFile };
    setFiles(newFiles);
    saveFilesToStore(newFiles);
  };
  const activeFileStat = (event, key) => {
    const currentFile = Object.values(files).find(
      (file) =>
        basename(file.path, extname(file.path)) === basename(key, extname(key))
    );
    if (currentFile) {
      const modifiedFile = {
        ...currentFile,
        isSynced: true,
        updatedAt: new Date().getTime(),
      };
      const newFiles = { ...files, [currentFile.id]: modifiedFile };
      setFiles(newFiles);
      saveFilesToStore(newFiles);
    }
  };
  const activeDownloadAllFile = (event, updatedFiles) => {
    const newFiles = {
      ...files,
      ...updatedFiles,
    };
    setFiles(newFiles);
    saveFilesToStore(newFiles);
  };
  const activeFileDownloaded = (event, message) => {
    const currentFile = files[message.id];
    const { id, path } = currentFile;
    fileHelper.readFile(path).then((value) => {
      let newFile;
      if (message.status === "download-success") {
        newFile = {
          ...files[id],
          body: value,
          isLoaded: true,
          isSynced: true,
          updatedAt: new Date().getTime(),
        };
      } else {
        newFile = { ...files[id], body: value, isLoaded: true };
      }
      const newFiles = { ...files, [id]: newFile };
      setFiles(newFiles);
      saveFilesToStore(newFiles);
    });
  };
  const filesUploaded = () => {
    const newFiles = objToArr(files).reduce((result, file) => {
      const currentTime = new Date().getTime();
      result[file.id] = {
        ...files[file.id],
        isSynced: true,
        updatedAt: currentTime,
      };
      return result;
    }, {});
    setFiles(newFiles);
    saveFilesToStore(newFiles);
  };
  useIpcRenderer({
    "create-new-file": createNewFile,
    "import-file": importFiles,
    "save-edit-file": saveCurrentFile,
    "active-file-uploaded": activeFileUploaded,
    "active-file-stat": activeFileStat,
    "file-downloaded": activeFileDownloaded,
    "files-uploaded": filesUploaded,
    "loading-status": (message, status) => {
      setLoading(status);
    },
    "active-download-all-file": activeDownloadAllFile,
  });
  return (
    <div className="App container-fluid px-0">
      {isLoading && <Loader />}
      <div className="row g-0">
        <div className="col-3 bg-light left-panel">
          <FileSearch title="My Document" onFileSearch={fileSearch} />
          <FileList
            files={fileListArr}
            onFileClick={fileClick}
            onFileDelete={deleteFile}
            onSaveEdit={updateFileName}
          />
          <div className="row g-0 button-group">
            <div className="col d-grid">
              <BottomBtn
                text="新建"
                colorClass="btn-primary"
                icon={faPlus}
                onBtnClick={createNewFile}
              />
            </div>
            <div className="col d-grid">
              <BottomBtn
                text="导入"
                colorClass="btn-success"
                icon={faFileImport}
                onBtnClick={importFiles}
              />
            </div>
          </div>
        </div>
        <div className="col-9 right-panel">
          {!activeFile && (
            <div className="start-page">选择或者创建新的 Markdown 文档</div>
          )}
          {activeFile && (
            <>
              <TabList
                files={openedFiles}
                activeId={activeFileID}
                unsaveIds={unsavedFileIDs}
                onTabClick={tabClick}
                onCloseTab={tabClose}
              />
              <SimpleMDE
                key={activeFile && activeFile.id}
                value={activeFile && activeFile.body}
                onChange={(value) => {
                  fileChange(activeFile.id, value);
                }}
                options={{
                  minHeight: "515px",
                }}
              />
              {activeFile.isSynced && (
                <span className="sync-status">
                  已同步，上次同步{timestampToString(activeFile.updatedAt)}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
