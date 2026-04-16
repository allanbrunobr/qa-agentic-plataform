import type {
  GeneratedAdapterFileResponse,
  GeneratedAdapterFilesResponse,
  UpdateGeneratedAdapterFileRequest,
  UpdateGeneratedAdapterFileResponse,
} from '../types/api.ts'
import {
  listGeneratedAdapterFiles,
  readGeneratedAdapterFile,
  writeGeneratedAdapterFile,
} from '../services/generated-adapter-files.ts'

export async function handleGeneratedAdapterFilesRequest(adapterId: string): Promise<GeneratedAdapterFilesResponse> {
  return {
    adapterId,
    files: await listGeneratedAdapterFiles(adapterId),
  }
}

export async function handleGeneratedAdapterFileRequest(
  adapterId: string,
  filename: string,
): Promise<GeneratedAdapterFileResponse> {
  const file = await readGeneratedAdapterFile(adapterId, filename)
  return {
    adapterId,
    filename,
    filePath: file.filePath,
    content: file.content,
  }
}

export async function handleGeneratedAdapterFileUpdateRequest(
  adapterId: string,
  filename: string,
  body: UpdateGeneratedAdapterFileRequest,
): Promise<UpdateGeneratedAdapterFileResponse> {
  if (typeof body.content !== 'string') throw new Error('content is required')
  const file = await writeGeneratedAdapterFile(adapterId, filename, body.content)
  return {
    adapterId,
    filename,
    filePath: file.filePath,
    saved: true,
  }
}
