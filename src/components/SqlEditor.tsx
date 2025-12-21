import { useMemo, useEffect, useState, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { rosePineDawn, barf } from "thememirror";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRunQuery?: () => void;
  height?: string;
}

export function SqlEditor({
  value,
  onChange,
  onRunQuery,
  height = "300px",
}: SqlEditorProps) {
  const [isDark, setIsDark] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkTheme = () => {
      const isDarkMode = document.documentElement.classList.contains("dark");
      setIsDark(isDarkMode);
    };

    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        setContainerWidth(width);
      }
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);

    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  const runQueryKeymap = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              if (onRunQuery) {
                onRunQuery();
                return true;
              }
              return false;
            },
          },
        ])
      ),
    [onRunQuery]
  );

  const extensions = useMemo(() => [runQueryKeymap, sql()], [runQueryKeymap]);

  return (
    <div
      ref={containerRef}
      className="border rounded-md overflow-hidden w-full"
    >
      <div className="overflow-x-auto">
        <CodeMirror
          value={value}
          height={height}
          width={containerWidth ? `${containerWidth}px` : "100%"}
          extensions={extensions}
          theme={isDark ? barf : rosePineDawn}
          onChange={onChange}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            dropCursor: false,
            allowMultipleSelections: false,
            indentOnInput: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            highlightSelectionMatches: false,
          }}
        />
      </div>
    </div>
  );
}
