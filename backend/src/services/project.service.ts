import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

import env from "../config/env";
import {
  CreateProjectResponse,
  Genre,
  InputType,
} from "../types/project.types";

import {
  ensureDirectory,
  isSupportedVideo,
} from "../utils/file.utils";

import { probeVideo } from "./video.service";

interface CreateProjectParams {
  projectName: string;
  genre: Genre;
  inputType: InputType;
  sourceUrl?: string;
  file?: {
  originalname: string;
  buffer: Buffer;
};
}

export async function createProject(
  params: CreateProjectParams
): Promise<CreateProjectResponse> {

  // 파일 업로드 방식
  if (params.inputType === "FILE") {

    // 파일이 실제로 전달되었는지 확인
    if (!params.file) {
      throw new Error("영상 파일이 없습니다.");
    }

    // MP4 / MOV 확인
    if (!isSupportedVideo(params.file.originalname)) {
      throw new Error(
        "MP4 또는 MOV 파일만 지원합니다."
      );
    }

    // 프로젝트 ID 생성
    const projectId = uuidv4();

    // 저장 폴더가 없으면 생성
    ensureDirectory(env.uploadDir);

    // 원본 파일 확장자
    const extension = path.extname(
      params.file.originalname
    );

    // 서버에 저장할 파일명
    const savedFilename =
      `${projectId}${extension}`;

    const savedPath = path.join(
      env.uploadDir,
      savedFilename
    );

    // 파일 저장
    fs.writeFileSync(
      savedPath,
      params.file.buffer
    );

    try {

      // ffprobe로 영상 정보 확인
      const metadata =
        await probeVideo(savedPath);

      return {
        success: true,
        projectId,
        status: "READY",
        inputType: "FILE",
        genre: params.genre,

        metadata: {
          filename:
            params.file.originalname,

          ...metadata,
        },

        message:
          "영상이 정상적으로 등록되었습니다.",
      };

    } catch (error) {

      // 영상 분석 실패 시 저장한 파일 삭제
      if (fs.existsSync(savedPath)) {
        fs.unlinkSync(savedPath);
      }

      throw new Error(
        "손상되었거나 분석할 수 없는 영상 파일입니다."
      );
    }
  }

  throw new Error(
    "현재 지원하지 않는 입력 방식입니다."
  );
}