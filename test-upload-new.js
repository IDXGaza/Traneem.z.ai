async function testUpload() {
  const formData = new FormData();
  const blob = new Blob(["test"], { type: "text/plain" });
  formData.append('file', blob, "test.txt");
  formData.append('upload_preset', 's4ipx1wf');

  try {
    const response = await fetch('https://api.cloudinary.com/v1_1/dt59bwxwc/auto/upload', {
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
