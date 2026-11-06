import { spawn } from "child_process";
import ffprobe from "ffprobe-static";

import { VideoMetadata } from "../types/project.types";

export function probeVideo(
  filePath: string
): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const process = spawn(ffprobe.path, [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);

    let output = "";
    let errorOutput = "";

    process.stdout.on("data", (data) => {
      output += data.toString();
    });

    process.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    process.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            errorOutput ||
              "영상 정보를 확인할 수 없습니다."
          )
        );

        return;
      }

      try {
        const result = JSON.parse(output);

        const videoStream =
          result.streams?.find(
            (stream: any) =>
              stream.codec_type === "video"
          );

        const audioStream =
          result.streams?.find(
            (stream: any) =>
              stream.codec_type === "audio"
          );

        resolve({
          format: result.format?.format_name,
          duration: Number(
            result.format?.duration
          ),
          width: videoStream?.width,
          height: videoStream?.height,
          videoCodec:
            videoStream?.codec_name,
          audioCodec:
            audioStream?.codec_name,
        });
      } catch {
        reject(
          new Error(
            "영상 메타데이터 분석에 실패했습니다."
          )
        );
      }
    });
  });
}