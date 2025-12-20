declare module "*.css" {
  const content: { [className: string]: string };
  export default content;
}

declare module "@xterm/xterm/css/xterm.css";
