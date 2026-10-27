"""CI's round trip of the Action's artifact client, second half (scripts/artifact-roundtrip.ts uploads).

Downloads the artifact with the REST API (GET /repos/{owner}/{repo}/actions/artifacts/{id}/zip: a 302 to a signed URL,
followed without the Authorization header) and checks it with an independent reader, Python's zipfile: the entries'
names and bytes must be exactly the files the harness wrote to $RUNNER_TEMP/saidvsdid-roundtrip.
"""
import io
import os
import sys
import urllib.request
import zipfile


def main():
    repo = os.environ["GITHUB_REPOSITORY"]
    artifact = os.environ["ARTIFACT_ID"]
    if not artifact.isdigit():
        sys.exit("no artifact id: the upload step did not run or failed")
    api = os.environ.get("GITHUB_API_URL", "https://api.github.com")
    request = urllib.request.Request("%s/repos/%s/actions/artifacts/%s/zip" % (api, repo, artifact))
    # Not forwarded to the redirect's signed storage URL.
    request.add_unredirected_header("Authorization", "Bearer %s" % os.environ["GH_TOKEN"])
    request.add_header("Accept", "application/vnd.github+json")
    data = urllib.request.urlopen(request, timeout=120).read()
    archive = zipfile.ZipFile(io.BytesIO(data))
    bad = archive.testzip()
    if bad is not None:
        sys.exit("a corrupt entry: %s" % bad)
    folder = os.path.join(os.environ["RUNNER_TEMP"], "saidvsdid-roundtrip")
    expected = sorted(os.listdir(folder))
    names = sorted(archive.namelist())
    if names != expected:
        sys.exit("entries %r, expected %r" % (names, expected))
    for name in names:
        with open(os.path.join(folder, name), "rb") as f:
            if archive.read(name) != f.read():
                sys.exit("%s: the bytes differ" % name)
    print("artifact round trip: %d entries, names and bytes as uploaded (%s)" % (len(names), ", ".join(names)))


main()
