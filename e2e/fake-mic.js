// Test-only: getUserMedia returns the fixture recording, so hold-to-talk can run without a real mic.
// run.sh fills in __ROOT__ (route.fulfill needs an absolute path).
async (page) => {
  await page.route('**/__fixture.wav', (route) => route.fulfill({ path: '__ROOT__/e2e/fixtures/tip.wav', contentType: 'audio/wav' }));
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      await ctx.resume();
      const buffer = await ctx.decodeAudioData(await (await fetch('/__fixture.wav')).arrayBuffer());
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const dest = ctx.createMediaStreamDestination();
      source.connect(dest);
      source.start();
      return dest.stream;
    };
  });
}
