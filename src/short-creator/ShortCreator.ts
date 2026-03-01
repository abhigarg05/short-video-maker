import fs from "fs-extra";
import cuid from "cuid";
import path from "path";
import https from "https";
import http from "http";

import { Kokoro } from "./libraries/Kokoro";
import { FFmpegRenderer } from "./libraries/FFmpegRenderer";
import { Whisper } from "./libraries/Whisper";
import { FFMpeg } from "./libraries/FFmpeg";
import { PexelsAPI } from "./libraries/Pexels";
import { Config } from "../config";
import { logger } from "../logger";
import { MusicManager } from "./music";
import { generateASS } from "./utils/ass";
import { OrientationEnum } from "../types/shorts";
import type { SceneInput, RenderConfig, VideoStatus, MusicMoodEnum, MusicTag, MusicForVideo } from "../types/shorts";

export class ShortCreator {
  private queue: { sceneInput: SceneInput[]; config: RenderConfig; id: string }[] = [];
  constructor(
    private config: Config,
    private renderer: FFmpegRenderer,
    private kokoro: Kokoro,
    private whisper: Whisper,
    private ffmpeg: FFMpeg,
    private pexelsApi: PexelsAPI,
    private musicManager: MusicManager,
  ) {}

  public status(id: string): VideoStatus {
    const videoPath = this.getVideoPath(id);
    if (this.queue.find((item) => item.id === id)) return "processing";
    if (fs.existsSync(videoPath)) return "ready";
    return "failed";
  }

  public addToQueue(sceneInput: SceneInput[], config: RenderConfig): string {
    const id = cuid();
    this.queue.push({ sceneInput, config, id });
    if (this.queue.length === 1) this.processQueue();
    return id;
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0) return;
    const { sceneInput, config, id } = this.queue[0];
    try {
      await this.createShort(id, sceneInput, config);
    } catch (error: unknown) {
      logger.error(error, "Error creating video");
    } finally {
      this.queue.shift();
      this.processQueue();
    }
  }

  private async createShort(videoId: string, inputScenes: SceneInput[], config: RenderConfig): Promise<string> {
    const videoPaths: string[] = [];
    const audioPaths: string[] = [];
    const assPaths: string[] = [];
    const tempFiles: string[] = [];
    let totalDuration = 0;
    const excludeVideoIds: string[] = [];

    const orientation = config.orientation || OrientationEnum.portrait;

    for (const scene of inputScenes) {
      const audio = await this.kokoro.generate(scene.text, config.voice ?? "af_heart");
      const { audioLength, audio: audioStream } = audio;

      const tempId = cuid();
      const tempWavPath = path.join(this.config.tempDirPath, `${tempId}.wav`);
      const tempMp3Path = path.join(this.config.tempDirPath, `${tempId}.mp3`);
      const tempVideoPath = path.join(this.config.tempDirPath, `${tempId}.mp4`);
      const tempAssPath = path.join(this.config.tempDirPath, `${tempId}.ass`);
      
      tempFiles.push(tempWavPath, tempMp3Path, tempVideoPath, tempAssPath);

      await this.ffmpeg.saveNormalizedAudio(audioStream, tempWavPath);
      const captions = await this.whisper.CreateCaption(tempWavPath);
      await generateASS(captions, tempAssPath);
      await this.ffmpeg.saveToMp3(audioStream, tempMp3Path);

      const video = await this.pexelsApi.findVideo(scene.searchTerms, audioLength, excludeVideoIds, orientation);
      excludeVideoIds.push(video.id);

      await new Promise<void>((resolve, reject) => {
        const fileStream = fs.createWriteStream(tempVideoPath);
        https.get(video.url, (response) => {
          if (response.statusCode !== 200) return reject(new Error(`Failed to download`));
          response.pipe(fileStream);
          fileStream.on("finish", () => { fileStream.close(); resolve(); });
        }).on("error", (err) => { fs.unlink(tempVideoPath, () => {}); reject(err); });
      });

      videoPaths.push(tempVideoPath);
      audioPaths.push(tempMp3Path);
      assPaths.push(tempAssPath);
      totalDuration += audioLength;
    }

    const selectedMusic = this.findMusic(totalDuration, config.music);
    const absoluteMusicPath = path.resolve(selectedMusic.localFilepath);

    await this.renderer.renderVideo(
      videoId,
      videoPaths,
      audioPaths,
      assPaths,
      absoluteMusicPath,
      config.musicVolume || 'high'
    );

    for (const file of tempFiles) fs.removeSync(file);
    return videoId;
  }

  public getVideoPath(videoId: string): string { return path.join(this.config.videosDirPath, `${videoId}.mp4`); }
  public deleteVideo(videoId: string): void { fs.removeSync(this.getVideoPath(videoId)); }
  public getVideo(videoId: string): Buffer { return fs.readFileSync(this.getVideoPath(videoId)); }
  private findMusic(videoDuration: number, tag?: MusicMoodEnum): MusicForVideo {
    const musicFiles = this.musicManager.musicList().filter(m => tag ? m.mood === tag : true);
    return musicFiles[Math.floor(Math.random() * musicFiles.length)];
  }
  public ListAvailableMusicTags(): MusicTag[] {
    return Array.from(new Set(this.musicManager.musicList().map(m => m.mood as MusicTag)));
  }
  public listAllVideos(): { id: string; status: VideoStatus }[] {
    const videos: { id: string; status: VideoStatus }[] = [];
    if (!fs.existsSync(this.config.videosDirPath)) return videos;
    fs.readdirSync(this.config.videosDirPath).filter(f => f.endsWith(".mp4")).forEach(file => {
      const id = file.replace(".mp4", "");
      videos.push({ id, status: this.queue.find(i => i.id === id) ? "processing" : "ready" });
    });
    this.queue.forEach(q => { if (!videos.find(v => v.id === q.id)) videos.push({ id: q.id, status: "processing" }); });
    return videos;
  }
  public ListAvailableVoices(): string[] { return this.kokoro.listAvailableVoices(); }
}
