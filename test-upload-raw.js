async function testUpload() {
  const formData = new FormData();
  const blob = new Blob(["test"], { type: "text/plain" });
  formData.append('file', blob, "test.txt");
  formData.append('upload_preset', 'dt59bwxwc');

  try {
    const response = await fetch('https://api.cloudinary.com/v1_1/s4ipx1wf/raw/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await response.json();
    console.log("Response:", data);
  } catch (e) {
    console.error("Error:", e);
  }
}

testUpload();
