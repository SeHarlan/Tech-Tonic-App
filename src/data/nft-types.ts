export interface NftAttribute {
  trait_type: string;
  value: string;
}

export interface NftItem {
  id: string;
  name: string;
  seed: number;
  thumbnailUrl: string;
  attributes: NftAttribute[];
}
