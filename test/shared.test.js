import {beforeEach, test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

//minimal replacement for the chrome extension api, shared.js only needs the local storage
let store = {};
globalThis.chrome = {
    storage: {
        local: {
            get: async (keys) => Object.fromEntries(keys.filter(key => key in store).map(key => [key, structuredClone(store[key])])),
            set: async (values) => {
                await new Promise(resolve => setTimeout(resolve, 5)); //makes lost updates visible
                Object.assign(store, structuredClone(values));
            }
        },
        onChanged: {
            addListener() {
            }
        }
    }
};

const shared = await import("../content/shared.js");

beforeEach(() => {
    store = {};
});

test("channelFromUrl extracts lower case channel names", () => {
    assert.equal(shared.channelFromUrl("https://www.twitch.tv/SomeChannel?referrer=raid"), "somechannel");
    assert.equal(shared.channelFromUrl("/foo_bar/videos", "https://www.twitch.tv"), "foo_bar");
});

test("channelFromUrl ignores urls that are no channels", () => {
    const urls = [
        "https://www.twitch.tv/",
        "https://www.twitch.tv/directory/following",
        "https://www.twitch.tv/videos/123",
        "https://www.twitch.tv/popout/somechannel/chat",
        "https://www.twitch.tv/a%20b",
        "https://dashboard.twitch.tv/u/somechannel",
        "https://example.com/somechannel",
        "not a url",
        null
    ];
    urls.forEach(url => assert.equal(shared.channelFromUrl(url), null, String(url)));
    assert.equal(shared.channelFromUrl(null, "https://www.twitch.tv"), null);
});

test("parseRaidMessage finds raider and number of raiders", () => {
    assert.deepEqual(shared.parseRaidMessage("SomeOne is raiding with a party of 12!"), {raider: "someone", viewers: 12});
    assert.deepEqual(shared.parseRaidMessage("SomeOne is raiding with a party of 1,234."), {raider: "someone", viewers: 1234});
    assert.deepEqual(shared.parseRaidMessage("SomeOne raidet mit einer Gruppe von 1.234!"), {raider: "someone", viewers: 1234});
    assert.deepEqual(shared.parseRaidMessage("SomeOne is raiding with a party of"), {raider: "someone", viewers: null});
});

test("parseRaidMessage ignores messages written by users", () => {
    assert.equal(shared.parseRaidMessage("troll: fake is raiding with a party of 5"), null);
    assert.equal(shared.parseRaidMessage("12:01troll: fake is raiding with a party of 5"), null);
    assert.equal(shared.parseRaidMessage("<img> is raiding with a party of 5"), null);
    assert.equal(shared.parseRaidMessage("hello chat"), null);
    assert.equal(shared.parseRaidMessage(null), null);
});

test("sanitizeImportedRaids imports the dummy data without merging entries", () => {
    const dummyData = JSON.parse(readFileSync(new URL("../other_resources/dummy_raid_data_bkp.json", import.meta.url), "utf8"));
    const {raids, skipped} = shared.sanitizeImportedRaids(dummyData);
    assert.equal(skipped, 0);
    assert.equal(raids.length, dummyData.length);
    assert.equal(raids[0].source, "dummyraid");
    assert.ok(raids.every(raid => typeof raid.uuid === "string" && raid.uuid.length > 0));
    //importing the same file twice adds nothing
    const merged = shared.mergeRaids(shared.mergeRaids([], raids), shared.sanitizeImportedRaids(dummyData).raids);
    assert.equal(merged.length, dummyData.length);
});

test("sanitizeImportedRaids skips invalid entries and unknown fields", () => {
    const {raids, skipped} = shared.sanitizeImportedRaids([
        null,
        5,
        {},
        {source: "a", target: "b", timestamp: "nope"},
        {source: "a", target: "", timestamp: "2026-01-01T00:00:00Z"},
        {source: "A", target: "b", timestamp: "2026-01-01T00:00:00Z", dataOrigin: "evil", viewers: -3, other: 1},
        {source: "c", target: "d", timestamp: "2026-01-02T00:00:00Z", dataOrigin: "chat", viewers: 7}
    ]);
    assert.equal(skipped, 5);
    assert.deepEqual(raids.map(({uuid, ...raid}) => raid), [
        {source: "a", target: "b", timestamp: "2026-01-01T00:00:00.000Z"},
        {source: "c", target: "d", timestamp: "2026-01-02T00:00:00.000Z", dataOrigin: "chat", viewers: 7}
    ]);
    assert.throws(() => shared.sanitizeImportedRaids({}));
});

test("mergeRaids sorts by date and removes duplicates", () => {
    const merged = shared.mergeRaids(
        [{uuid: "a", source: "x", target: "y", timestamp: "2026-01-02T00:00:00.000Z"}],
        [
            {uuid: "a", source: "x", target: "y", timestamp: "2026-01-02T00:00:00.000Z"},
            {uuid: "b", source: "X", target: "Y", timestamp: "2026-01-02T00:00:00.000Z"},
            {uuid: "c", source: "x", target: "z", timestamp: "2026-01-01T00:00:00.000Z"}
        ]
    );
    assert.deepEqual(merged.map(raid => raid.uuid), ["c", "a"]);
});

test("saveRaid keeps all raids when saving in parallel", async () => {
    await Promise.all([
        shared.saveRaid("A", "B", "raid"),
        shared.saveRaid("C", "D", "chat", 42),
        shared.saveRaid("E", "F", "raid")
    ]);
    assert.deepEqual(store.raids.map(raid => `${raid.source}>${raid.target}`), ["a>b", "c>d", "e>f"]);
    assert.equal(store.raids[1].viewers, 42);
    assert.ok(!("viewers" in store.raids[0]));
});

test("deleteRaid removes only the given raid", async () => {
    await shared.saveRaid("a", "b", "raid");
    await shared.saveRaid("c", "d", "raid");
    await shared.deleteRaid(store.raids[0]);
    assert.deepEqual(store.raids.map(raid => raid.source), ["c"]);
});

test("pruneRaids removes raids older than the retention", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    const raids = [
        {source: "a", target: "b", timestamp: "2026-01-01T00:00:00.000Z"},
        {source: "a", target: "b", timestamp: "2026-04-01T00:00:00.000Z"},
        {source: "a", target: "b", timestamp: "2026-06-01T00:00:00.000Z"}
    ];
    assert.equal(shared.pruneRaids(raids, 0, now).length, 3);
    assert.equal(shared.pruneRaids(raids, 3, now).length, 2);
    assert.equal(shared.pruneRaids(raids, 1, now).length, 1);
});

test("the retention is applied when a raid is saved", async () => {
    store.retentionMonths = 1;
    store.raids = [{uuid: "old", source: "a", target: "b", timestamp: "2020-01-01T00:00:00.000Z"}];
    await shared.saveRaid("c", "d", "raid");
    assert.deepEqual(store.raids.map(raid => raid.source), ["c"]);
});

test("summarizeChannel counts incoming and outgoing raids", () => {
    const raids = [
        {source: "a", target: "me", timestamp: "2026-01-01T00:00:00.000Z", dataOrigin: "raid"},
        {source: "b", target: "Me", timestamp: "2026-01-03T00:00:00.000Z", dataOrigin: "chat"},
        {source: "me", target: "c", timestamp: "2026-01-02T00:00:00.000Z", dataOrigin: "raid"},
        {source: "x", target: "y", timestamp: "2026-01-02T00:00:00.000Z", dataOrigin: "raid"}
    ];
    const all = shared.summarizeChannel(raids, "me", true);
    assert.deepEqual(all.incoming.map(raid => raid.source), ["b", "a"]);
    assert.deepEqual(all.outgoing.map(raid => raid.target), ["c"]);
    assert.match(shared.describeChannelSummary(all), /^Raided here 2x, last from b on .+\. Raided away from here 1x, last to c$/);
    const withoutChat = shared.summarizeChannel(raids, "me", false);
    assert.deepEqual(withoutChat.incoming.map(raid => raid.source), ["a"]);
    assert.equal(shared.describeChannelSummary(shared.summarizeChannel(raids, "nobody", true)), "");
});

test("computeStats counts channels and months", () => {
    const now = new Date(2026, 5, 15);
    const raids = [
        {source: "a", target: "b", timestamp: new Date(2026, 5, 1).toISOString(), dataOrigin: "raid"},
        {source: "a", target: "c", timestamp: new Date(2026, 5, 2).toISOString(), dataOrigin: "chat"},
        {source: "d", target: "b", timestamp: new Date(2026, 3, 2).toISOString(), dataOrigin: "raid"},
        {source: "d", target: "b", timestamp: new Date(2020, 3, 2).toISOString(), dataOrigin: "raid"}
    ];
    const stats = shared.computeStats(raids, 1, 3, now);
    assert.equal(stats.total, 4);
    assert.equal(stats.fromChat, 1);
    assert.equal(stats.channels, 4);
    assert.deepEqual(stats.topSources, [{name: "a", count: 2}]);
    assert.deepEqual(stats.topTargets, [{name: "b", count: 3}]);
    assert.deepEqual(stats.perMonth, [{name: "2026-04", count: 1}, {name: "2026-05", count: 0}, {name: "2026-06", count: 2}]);
});
