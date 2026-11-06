import  { Request, Response } from "express";

import {
  createProject as createProjectService,
} from "../services/project.service";

import {
  Genre,
  InputType,
} from "../types/project.types";

export const createProject = async (
  req: Request,
  res: Response
) => {
  try {
    const {
      projectName,
      genre,
      inputType,
      sourceUrl,
    } = req.body;

    const file = req.file;

    const result = await createProjectService({
      projectName,
      genre: genre as Genre,
      inputType: inputType as InputType,
      sourceUrl,
      file: file
        ? {
            originalname: file.originalname,
            buffer: file.buffer,
          }
        : undefined,
    });

    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(error);

    return res.status(400).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "프로젝트 생성에 실패했습니다.",
    });
  }
};