export interface DatabaseTable {
  schema: string;
  name: string;
  type: "table" | "view";
}
