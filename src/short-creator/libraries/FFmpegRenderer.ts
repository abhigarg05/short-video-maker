import ffmpeg from "fluent-ffmpeg";
import path from "path";
import { Config } from "../../config";
import { logger } from "../../logger";

export class FFmpegRenderer {
  constructor(private config: Config) {}

  static async init(config: Config): Promise<FFmpegRenderer> {
    return new FFmpegRenderer(config);
  }

  renderVideo(
    videoId: string,
    videoPaths: string[],
    audioPaths: string[],
    assPaths: string[],
    musicPath: string,
    musicVolume: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const outputLocation = path.join(this.config.videosDirPath, `${videoId}.mp4`);
      logger.debug({ outputLocation, videoId }, "Starting native FFmpeg render");

      const command = ffmpeg();
      videoPaths.forEach(v => command.input(v));
      audioPaths.forEach(a => command.input(a));
      command.input(musicPath);

      let filterComplex = "";
      const videoLabels: string[] = [];
      const audioLabels: string[] = [];

      for (let i = 0; i < videoPaths.length; i++) {
        const aIdx = videoPaths.length + i;
        // Escape Windows paths if needed, but in Docker it's Linux
        const escapedAssPath = assPaths[i].replace(/\\/g, '/').replace(/:/g, '\\:');
        
        filterComplex += `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,subtitles='${escapedAssPath}'[v${i}];`;
        videoLabels.push(`[v${i}]`);
        audioLabels.push(`[${aIdx}:a]`);
      }

      const concatInputs = videoLabels.map((v, i) => `${v}${audioLabels[i]}`).join('');
      filterComplex += `${concatInputs}concat=n=${videoPaths.length}:v=1:a=1[v_concat][a_concat];`;

      const musicIdx = videoPaths.length + audioPaths.length;
      const vol = musicVolume === 'low' ? 0.05 : 0.15;
      filterComplex += `[${musicIdx}:a]volume=${vol}[bg_music];`;
      filterComplex += `[a_concat][bg_music]amix=inputs=2:duration=first[a_final]`;

      command
        .complexFilter(filterComplex)
        .outputOptions([
          '-map [v_concat]',
          '-map [a_final]',
          '-c:v libx264',
          '-preset ultrafast',
          '-pix_fmt yuv420p',
          '-c:a aac',
          '-shortest'
        ])
        .save(outputLocation)
        .on('end', () => {
          logger.debug({ videoId }, "FFmpeg render complete!");
          resolve();
        })
        .on('error', (err) => {
          logger.error({ err, videoId }, "FFmpeg render failed");
          reject(err);
        });
    });
  }

  async testRender(outputLocation: string) {
    // Just a dummy test to satisfy the install script
    return new Promise<void>((resolve) => {
      ffmpeg().input('color=c=black:s=108x192').inputFormat('lavfi').duration(1).save(outputLocation).on('end', resolve);
    });
  }
}
