import {readFile, writeFile} from "node:fs/promises";
import {expect, test} from "@playwright/test";

// Exercise the direct camera stream used by the studio with the real production
// encoder, OPFS store, stereo processor and export path (no recorder mocks).
test.beforeEach(async ({page}) => { await page.goto("./"); });

for (const resolution of [1080]) {
for (const mirrored of [true, false]) {
  for (const portrait of [true, false]) {
    test(`encoded ${resolution} ${mirrored ? "front" : "rear"} ${portrait ? "portrait" : "landscape"} preserves direct camera pixels`, async ({page}, info) => {
      test.setTimeout(45000);
      const downloading = page.waitForEvent("download");
      const result = await page.evaluate(async ({mirrored, portrait, resolution}) => {
        const core = await import("./prompter/runtime.js");
        const scene = document.createElement("canvas");
        const longSide = resolution * 16 / 9;
        scene.width = portrait ? resolution : longSide;
        scene.height = portrait ? longSide : resolution;
        const paint = scene.getContext("2d", {alpha:false});
        let frame = 0, audioClock, syncAt = Infinity;
        function draw() {
          paint.fillStyle = "#e02828";
          paint.fillRect(0, 0, scene.width / 2, scene.height);
          paint.fillStyle = "#26a471";
          paint.fillRect(scene.width / 2, 0, scene.width / 2, scene.height);
          paint.fillStyle = "white";
          paint.font = "60px sans-serif";
          paint.fillText("LEFT 123 >", 40, 90);
          paint.fillText("RIGHT", scene.width / 2 + 40, 90);
          paint.fillRect((frame++ * 13) % (scene.width - 60), scene.height - 100, 60, 60);
          const time = audioClock?.currentTime ?? 0;
          paint.fillStyle = time >= syncAt && time < syncAt + .35 ? "white" : "black";
          paint.fillRect(0, scene.height - 200, scene.width, 70);
        }
        draw();
        const cameraStream = scene.captureStream(30);
        const camera = cameraStream.getVideoTracks()[0];
        const timer = setInterval(draw, 1000 / 30);
        const context = new AudioContext({sampleRate:48000});
        audioClock = context;
        await context.resume();
        const destination = context.createMediaStreamDestination();
        const merger = context.createChannelMerger(2);
        const gains = [];
        const oscillators = [440, 880].map((frequency, channel) => {
          const tone = context.createOscillator(), gain = context.createGain();
          tone.frequency.value = frequency;
          gain.gain.value = 0;
          gains.push(gain);
          tone.connect(gain).connect(merger, 0, channel);
          tone.start();
          return tone;
        });
        merger.connect(destination);
        const microphone = destination.stream.getAudioTracks()[0];
        const stream = new MediaStream([camera, microphone]);
        const preview = document.createElement("video");
        preview.muted = true;
        preview.playsInline = true;
        preview.classList.toggle("mirrored", mirrored);
        preview.style.transform = mirrored ? "scaleX(-1)" : "none";
        document.body.append(preview);
        preview.srcObject = stream;
        await preview.play();
        let reason;
        const session = await core.VideoSession.create(stream, () => {}, text => { reason = text; },
          {owner:"mirror-test", contentId:"asymmetric", title:"Asymmetric LEFT 123", framing:portrait ? "portrait" : "landscape"}, context);
        await new Promise(resolve => session.start(resolve));
        syncAt = context.currentTime + .5;
        for (const gain of gains) {
          gain.gain.setValueAtTime(.2, syncAt);
          gain.gain.setValueAtTime(0, syncAt + .35);
          gain.gain.setValueAtTime(.2, syncAt + 1);
        }
        await new Promise(resolve => setTimeout(resolve, 3300));
        await session.stop();
        const originalTracksLive = stream.getTracks().every(track => track.readyState === "live");
        const stored = (await core.DraftStore.list()).find(clip => clip.id === session.meta.id);
        const file = await core.DraftStore.file(stored);
        const player = document.createElement("video");
        player.muted = true;
        player.playsInline = true;
        player.src = URL.createObjectURL(file);
        await player.play();
        await new Promise(resolve => setTimeout(resolve, 350));
        player.pause();
        const frameCanvas = document.createElement("canvas");
        frameCanvas.width = player.videoWidth;
        frameCanvas.height = player.videoHeight;
        const sample = frameCanvas.getContext("2d");
        sample.drawImage(player, 0, 0);
        const colors = [.15, .85].map(side => {
          const [r, g] = sample.getImageData(Math.floor(side * frameCanvas.width), Math.floor(frameCanvas.height / 2), 1, 1).data;
          return r > g ? "red" : "green";
        });
        const playback = {width:player.videoWidth, height:player.videoHeight, duration:player.duration, colors};
        const decoded = await context.decodeAudioData(await file.arrayBuffer());
        const audio = {channels:decoded.numberOfChannels, rate:decoded.sampleRate};
        const left = decoded.getChannelData(0);
        let soundAt = 0;
        for (let i = 0; i < left.length; i++) {
          if (Math.abs(left[i]) > .01) { soundAt = i / decoded.sampleRate; break; }
        }
        let flashAt;
        for (let time = Math.max(.01, soundAt - .2); time < soundAt + .25; time += 1 / 30) {
          await new Promise(resolve => { player.onseeked = resolve; player.currentTime = time; });
          sample.drawImage(player, 0, 0);
          if (sample.getImageData(100, frameCanvas.height - 170, 1, 1).data[0] > 220) { flashAt = time; break; }
        }
        const sync = {soundAt, flashAt, delta:flashAt === undefined ? null : flashAt - soundAt};
        // Different tones in left/right channels must survive the existing audio graph.
        audio.tones = Array.from({length:decoded.numberOfChannels}, (_, channel) => {
          const samples = decoded.getChannelData(channel);
          return [440, 880].map(hz => {
            let sin = 0, cos = 0;
            const start = Math.floor(decoded.sampleRate / 2), end = Math.min(samples.length, Math.floor(decoded.sampleRate * 2));
            for (let i = start; i < end; i++) {
              const angle = 2 * Math.PI * hz * i / decoded.sampleRate;
              sin += samples[i] * Math.sin(angle);
              cos += samples[i] * Math.cos(angle);
            }
            return 2 * Math.hypot(sin, cos) / (end - start);
          });
        });
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), x => x.toString(16).padStart(2, "0")).join("");
        core.downloadVideo(file);
        clearInterval(timer);
        oscillators.forEach(tone => tone.stop());
        stream.getTracks().forEach(track => track.stop());
        await context.close();
        URL.revokeObjectURL(player.src);
        preview.remove();
        return {stored, playback, audio, sync, hash, originalTracksLive, reason, bytes:file.size};
      }, {mirrored, portrait, resolution});
      const file = info.outputPath("recording.mp4");
      await (await downloading).saveAs(file);
      const {createHash} = await import("node:crypto");
      await writeFile(info.outputPath("recording-report.json"), JSON.stringify(result, null, 2));
      await info.attach("recording-report", {path:info.outputPath("recording-report.json"), contentType:"application/json"});
      expect(createHash("sha256").update(await readFile(file)).digest("hex")).toBe(result.hash);
      expect(result.bytes).toBe(result.stored.bytes);
      expect(result.stored.complete).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.originalTracksLive).toBe(true);
      const longSide = resolution * 16 / 9;
      expect([result.playback.width, result.playback.height]).toEqual(portrait ? [resolution, longSide] : [longSide, resolution]);
      expect(result.playback.colors).toEqual(["red", "green"]);
      expect(result.stored.settings.frameRate).toBe(30);
      expect(result.stored.videoBitrate).toBe(resolution === 2160 ? 24000000 : 12000000);
      expect(result.stored.audioBitrate).toBe(256000);
      expect(result.audio.channels).toBe(2);
      expect(result.audio.rate).toBe(48000);
      expect(result.sync.delta).not.toBeNull();
      expect(Math.abs(result.sync.delta)).toBeLessThan(.1);
      expect(result.audio.tones[0][0]).toBeGreaterThan(.01);
      expect(result.audio.tones[0][0]).toBeGreaterThan(10 * result.audio.tones[0][1]);
      expect(result.audio.tones[1][1]).toBeGreaterThan(.01);
      expect(result.audio.tones[1][1]).toBeGreaterThan(10 * result.audio.tones[1][0]);
    });
  }
}
}
