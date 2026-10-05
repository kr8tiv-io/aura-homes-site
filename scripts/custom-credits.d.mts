export interface CustomModelCredit {
  name: string;
  author: string;
  license: string;
  link: string;
  licenseLink?: string;
  usedFor: string;
  category: '3D models';
  files: string[];
}

export function customModelCredits(root?: string): Promise<CustomModelCredit[]>;
