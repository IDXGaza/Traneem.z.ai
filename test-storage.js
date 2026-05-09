import { initializeApp } from "firebase/app";
import { getStorage, ref, uploadString } from "firebase/storage";
import config from "./firebase-applet-config.json" with { type: "json" };

const app = initializeApp(config);
const storage = getStorage(app);
const testRef = ref(storage, "test.txt");

uploadString(testRef, "hello world").then(() => {
  console.log("Success!");
}).catch(e => {
  console.error("Storage error:", e.message);
});
