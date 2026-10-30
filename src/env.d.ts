/// <reference types="vite/client" />

declare module 'mammoth/mammoth.browser.min.js' {
  interface ConversionResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  const mammoth: {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: Record<string, unknown>): Promise<ConversionResult>;
  };
  export default mammoth;
}
