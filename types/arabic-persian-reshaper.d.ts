declare module "arabic-persian-reshaper" {
  const pkg: {
    ArabicShaper: {
      convertArabic(input: string): string;
    };
  };
  export default pkg;
}
