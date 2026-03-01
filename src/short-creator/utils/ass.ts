import fs from "fs-extra";

function formatAssTime(seconds: number): string {
  const date = new Date(seconds * 1000);
  const h = date.getUTCHours();
  const m = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  const cs = String(Math.floor(date.getUTCMilliseconds() / 10)).padStart(2, "0");
  return `${h}:${m}:${s}.${cs}`;
}

export async function generateASS(captions: any[], outputPath: string) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TiktokStyle,Arial,70,&H00FFFFFF,&H0000FFFF,&H00000000,&H80D17B22,-1,0,0,0,100,100,0,0,3,4,0,2,10,10,250,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  let events = "";

  for (const caption of captions) {
    const start = formatAssTime(caption.start);
    const end = formatAssTime(caption.end);
    let text = "";
    
    // Whisper words processing for Karaoke effect
    if (caption.words && caption.words.length > 0) {
      for (const word of caption.words) {
        const durationCs = Math.max(1, Math.round((word.end - word.start) * 100));
        text += `{\\k${durationCs}}${word.text} `;
      }
    } else {
      text = caption.text;
    }

    events += `Dialogue: 0,${start},${end},TiktokStyle,,0,0,0,,${text.trim()}\n`;
  }

  await fs.writeFile(outputPath, header + events);
}
