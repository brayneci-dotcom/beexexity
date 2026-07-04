declare module 'turndown' {
  interface TurndownOptions {
    headingStyle?: 'setext' | 'atx';
    hr?: string;
    bulletListMarker?: '-' | '*' | '+';
    codeBlockStyle?: 'indented' | 'fenced';
    fence?: '```' | '~~~';
    emDelimiter?: '_' | '*';
    strongDelimiter?: '**' | '__';
    linkStyle?: 'inlined' | 'referenced';
    linkReferenceStyle?: 'full' | 'collapsed' | 'shortcut';
    preformattedCode?: boolean;
  }
  interface TurndownService {
    use(plugin: unknown): TurndownService;
    turndown(html: string): string;
  }
  interface TurndownStatic {
    new(options?: TurndownOptions): TurndownService;
  }
  const turndown: TurndownStatic;
  export default turndown;
}

declare module 'turndown-plugin-gfm' {
  interface GfmPlugin {
    gfm: (turndown: unknown) => void;
    tables: (turndown: unknown) => void;
    strikethrough: (turndown: unknown) => void;
    tasklistItems: (turndown: unknown) => void;
  }
  const plugin: GfmPlugin;
  export = plugin;
}
