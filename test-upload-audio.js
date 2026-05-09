async function testUpload() {
  const formData = new FormData();
  // Create a dummy audio file
  const audioData = new Uint8Array([0, 0, 0, 0]);
  const blob = new Blob([audioData], { type: "audio/mpeg" });
  formData.append('file', blob, "test.mp3");
  formData.append('upload_preset', 'dt59bwxwc');

  try {
    const response = await fetch('https://api.cloudinary.com/v1_1/s4ipx1wf/video/upload', {
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
