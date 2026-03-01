export type StorageUploadResult = {
  path: string;
  publicUrl: string;
};

export interface MediaStorageProvider {
  upload(path: string, file: File): Promise<StorageUploadResult>;
  getPublicUrl(path: string): string;
}
