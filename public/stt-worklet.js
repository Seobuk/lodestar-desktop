// 마이크 PCM 캡처 워클릿 — AudioContext가 16kHz mono로 리샘플한 프레임(128샘플)을
// 받아 ~1024샘플씩 모아 메인 스레드로 보낸다. 메인은 이를 stt_feed로 Rust에 전달.
class SttCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1024);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("stt-capture", SttCapture);
