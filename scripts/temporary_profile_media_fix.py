from pathlib import Path

path = Path("src/components/UserProfileModal.tsx")
text = path.read_text()
old = '''        <MediaViewer
          items={[{ type: "image", url: user.avatar_url }]}
          startIndex={0}
          onClose={() => setAvatarOpen(false)}
        />'''
new = '''        <MediaViewer
          src={user.avatar_url}
          kind="image"
          title={user.full_name || user.username || "Profile photo"}
          onClose={() => setAvatarOpen(false)}
        />'''
if old not in text:
    raise SystemExit("Expected profile MediaViewer block not found")
path.write_text(text.replace(old, new, 1))
