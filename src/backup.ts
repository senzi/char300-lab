import JSZip from "jszip";

export type ImportFile = Blob & {
  name: string;
  type: string;
};

export async function readBackupPayload(file: ImportFile): Promise<unknown> {
  if (isZipBackupFile(file)) {
    const zip = await JSZip.loadAsync(new Uint8Array(await file.arrayBuffer()));
    const dataFile = zip.file("zhuzi-data.json") ?? zip.file("char300-lab-data.json");
    if (!dataFile) {
      throw new Error("Backup JSON missing from zip");
    }

    return JSON.parse(await dataFile.async("string")) as unknown;
  }

  return JSON.parse(await file.text()) as unknown;
}

export async function generateCompressedZip(zip: JSZip): Promise<Blob> {
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}

export function isZipBackupFile(file: Pick<ImportFile, "name" | "type">): boolean {
  return file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}
