/// <reference path="../pb_data/types.d.ts" />
// Our Addis schema. Only signed-in members (max two, enforced in pb_hooks) can read or write.
// Records are never hard-deleted by the app: deletions are tombstones (deleted = true), so a
// mistaken tap or a sync race can never erase a memory from the home PC.
migrate((app) => {
  const AUTH = "@request.auth.id != '' && @request.auth.collectionName = 'users'";

  // ---- users: the two of us ----
  const users = app.findCollectionByNameOrId("users");
  users.listRule = AUTH;
  users.viewRule = AUTH;
  users.createRule = "";                 // open sign-up, capped at two accounts by a hook
  users.updateRule = "id = @request.auth.id";
  users.deleteRule = null;
  users.authToken.duration = 60 * 60 * 24 * 120; // 120 days, so long offline stretches don't log us out
  app.save(users);

  const common = () => [
    { name: "client_ts", type: "number", required: false },
    { name: "deleted", type: "bool" },
    { name: "created_by", type: "text", max: 32 },
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];
  const base = (name, fields, extra) => new Collection(Object.assign({
    type: "base", name,
    listRule: AUTH, viewRule: AUTH, createRule: AUTH, updateRule: AUTH, deleteRule: null,
    fields: fields.concat(common()),
    indexes: [`CREATE INDEX idx_${name}_updated ON ${name} (updated)`],
  }, extra || {}));

  app.save(base("places", [
    { name: "name", type: "text", required: true, max: 120 },
    { name: "lat", type: "number" },
    { name: "lng", type: "number" },
    { name: "area", type: "text", max: 80 },
    { name: "kind", type: "text", max: 20 },
    { name: "cuisine", type: "text", max: 80 },
    { name: "fasting_friendly", type: "bool" },
    { name: "price_level", type: "number" },
    { name: "notes", type: "text", max: 1000 },
    { name: "wishlist", type: "bool" },
    { name: "osm_id", type: "text", max: 40 },
  ]));

  app.save(base("visits", [
    { name: "place_id", type: "text", required: true, max: 32 },
    { name: "visited_on", type: "text", max: 10 },
    { name: "occasion", type: "text", max: 120 },
    { name: "ordered", type: "text", max: 1000 },
    { name: "food_review", type: "text", max: 3000 },
    { name: "place_review", type: "text", max: 3000 },
    { name: "r_food", type: "number" },
    { name: "r_vibe", type: "number" },
    { name: "r_service", type: "number" },
    { name: "r_value", type: "number" },
    { name: "spent_birr", type: "number" },
    { name: "fasting", type: "bool" },
  ]));

  app.save(base("photos", [
    { name: "visit_id", type: "text", required: true, max: 32 },
    { name: "image", type: "file", maxSelect: 1, maxSize: 15 * 1024 * 1024, protected: true,
      mimeTypes: ["image/jpeg", "image/png", "image/webp"], thumbs: ["800x0"] },
    { name: "width", type: "number" },
    { name: "height", type: "number" },
    { name: "caption", type: "text", max: 300 },
  ]));

  app.save(new Collection({
    type: "base", name: "recommendations",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "request", type: "json", maxSize: 20000 },
      { name: "result", type: "json", maxSize: 200000 },
      { name: "created_by", type: "text", max: 32 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
  }));

  // ---- automatic backups: every night at 03:00, keep two weeks ----
  const settings = app.settings();
  settings.meta.appName = "Our Addis";
  settings.backups.cron = "0 3 * * *";
  settings.backups.cronMaxKeep = 14;
  app.save(settings);
}, (app) => {
  for (const n of ["recommendations", "photos", "visits", "places"]) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {}
  }
});
