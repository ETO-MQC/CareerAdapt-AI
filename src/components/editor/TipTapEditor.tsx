"use client";

import { useCallback, useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";

export type TipTapEditorMode = "paragraph" | "highlight-list";

type TipTapEditorProps = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minRows?: number;
  ariaLabel?: string;
  mode?: TipTapEditorMode;
};

export function TipTapEditor({
  value,
  onChange,
  placeholder = "在此输入内容…",
  disabled = false,
  minRows = 6,
  ariaLabel = "内容编辑器",
  mode = "paragraph"
}: TipTapEditorProps) {
  const lastEmittedRef = useRef(value);
  const isHighlightList = mode === "highlight-list";

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        blockquote: false
      }),
      Placeholder.configure({ placeholder })
    ],
    content: value,
    editable: !disabled,
    editorProps: {
      attributes: {
        class: "tiptap-prosemirror",
        "aria-label": ariaLabel,
        style: `min-height: ${minRows * 1.5}rem`
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      const html = currentEditor.getHTML();
      lastEmittedRef.current = html;
      onChange(html);
    }
  });

  // Sync external value changes (e.g. when branch data refreshes after save)
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedRef.current) return;
    // Avoid clobbering the editor if the user is actively typing
    if (editor.isFocused) return;
    lastEmittedRef.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  const toggleBold = useCallback(() => {
    editor?.chain().focus().toggleBold().run();
  }, [editor]);

  const toggleItalic = useCallback(() => {
    editor?.chain().focus().toggleItalic().run();
  }, [editor]);

  const toggleBulletList = useCallback(() => {
    editor?.chain().focus().toggleBulletList().run();
  }, [editor]);

  const toggleOrderedList = useCallback(() => {
    editor?.chain().focus().toggleOrderedList().run();
  }, [editor]);

  if (!editor) {
    return <div className="tiptap-editor tiptap-editor-loading" />;
  }

  return (
    <div className="tiptap-editor">
      {!isHighlightList ? (
        <div className="tiptap-toolbar" role="toolbar" aria-label="文本格式">
          <button
            type="button"
            className={`tiptap-toolbar-button ${editor.isActive("bold") ? "tiptap-toolbar-button-active" : ""}`}
            onClick={toggleBold}
            disabled={disabled}
            aria-label="加粗"
            title="加粗"
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className={`tiptap-toolbar-button ${editor.isActive("italic") ? "tiptap-toolbar-button-active" : ""}`}
            onClick={toggleItalic}
            disabled={disabled}
            aria-label="斜体"
            title="斜体"
          >
            <em>I</em>
          </button>
          <button
            type="button"
            className={`tiptap-toolbar-button ${editor.isActive("bulletList") ? "tiptap-toolbar-button-active" : ""}`}
            onClick={toggleBulletList}
            disabled={disabled}
            aria-label="无序列表"
            title="无序列表"
          >
            •≡
          </button>
          <button
            type="button"
            className={`tiptap-toolbar-button ${editor.isActive("orderedList") ? "tiptap-toolbar-button-active" : ""}`}
            onClick={toggleOrderedList}
            disabled={disabled}
            aria-label="有序列表"
            title="有序列表"
          >
            1.
          </button>
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
