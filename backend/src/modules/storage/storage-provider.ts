export interface StorageProvider {
  upload(filePath: string, filename: string): Promise<string>;
  delete(filePath: string): Promise<void>;
  getSignedUrl(filePath: string): Promise<string>;
}
