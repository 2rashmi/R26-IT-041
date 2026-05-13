function ProfileDetails({ profile }) {
  // First-time users: section stays empty (no placeholder text).
  if (!profile) return null;

  return (
    <div className="profile-grid">
      <div><strong>User Code:</strong> {profile.user_code}</div>
      <div><strong>Reading Level:</strong> {profile.reading_level || profile.level}</div>
      <div><strong>Voice:</strong> {profile.voice}</div>
      <div><strong>Pace:</strong> {profile.pace}</div>
      <div><strong>Tone:</strong> {profile.tone}</div>
    </div>
  );
}

export default ProfileDetails;
