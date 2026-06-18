/**
 * Dynamic filtering and extraction utility for the Whiteboard Display System.
 * Separates textbook-quality lecture notes from conversational Hinglish chatter/filler words.
 */

export function extractBoardContent(text: string): string {
  if (!text) return "";

  // 1. Try to extract content wrapped inside <board>...</board> tags
  // This is streaming-safe: if the closing tag hasn't arrived yet, we take everything till the end
  if (text.toLowerCase().includes("<board>")) {
    const blocks: string[] = [];
    let currentIndex = 0;
    const lowerText = text.toLowerCase();
    
    while (true) {
      const openIdx = lowerText.indexOf("<board>", currentIndex);
      if (openIdx === -1) break;
      
      const startContent = openIdx + 7; // Length of "<board>"
      const closeIdx = lowerText.indexOf("</board>", startContent);
      
      if (closeIdx !== -1) {
        let content = text.slice(startContent, closeIdx).trim();
        content = content.replace(/^([\\/nN\s]+)/gi, "");
        content = content.replace(/[\\/]+n$/gi, "");
        content = content.replace(/[\\/]n(?![a-z])/gi, "\n");
        blocks.push(content.trim());
        currentIndex = closeIdx + 8; // Length of "</board>"
      } else {
        // Stream is ongoing, take everything till the end
        let content = text.slice(startContent).trim();
        content = content.replace(/^([\\/nN\s]+)/gi, "");
        content = content.replace(/[\\/]+n$/gi, "");
        content = content.replace(/[\\/]n(?![a-z])/gi, "\n");
        blocks.push(content.trim());
        break;
      }
    }
    
    return blocks.filter(Boolean).join("\n\n");
  }

  // Strictly return empty string if no <board> tags are found to prevent spoken conversation from typing onto the main chalkboard.
  return "";
}
